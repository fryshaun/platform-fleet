import { NextResponse, type NextRequest } from "next/server";

import { openRecoveryWindow } from "@/lib/recovery";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email callback.
 *
 * Two shapes arrive here:
 *
 * - `?code=…` — Google, and any link built from `redirectTo`. Exchanging it
 *   only works in the browser that started the flow, because `@supabase/ssr`
 *   keeps the PKCE verifier in a cookie.
 * - `?token_hash=…&type=…` — the form to use in email templates. The token is
 *   self-contained, so a confirmation or magic link can be opened on another
 *   device.
 *
 * `next` is validated to be a same-origin relative path so the callback cannot
 * be used as an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const errorDescription = searchParams.get("error_description");
  const next = safeNextPath(searchParams.get("next"));
  const verification = readVerification(searchParams);

  if (errorDescription) {
    return loginError(origin, errorDescription);
  }

  if (!verification) {
    return loginError(origin, "missing_code");
  }

  const supabase = await createClient();

  const { data, error } =
    verification.kind === "token_hash"
      ? await supabase.auth.verifyOtp({
          token_hash: verification.tokenHash,
          type: verification.type,
        })
      : await supabase.auth.exchangeCodeForSession(verification.code);

  if (error) {
    return loginError(origin, error.message);
  }

  await dropProviderTokens(supabase, data.session);

  // A recovery link is the only proof that `/reset-password` may replace a
  // password without the old one, so the browser that verified one is marked
  // here — after verification, never from a query parameter.
  if (verification.kind === "token_hash" && verification.type === "recovery") {
    await openRecoveryWindow();
  }

  // Only an invitation link proves consent to join somebody's workspace.
  // Google, magic-link and signup sessions are ordinary sign-ins, and a
  // membership somebody else created must not activate on the back of one of
  // those (see `20260101000700_invitation_consent.sql`).
  if (verification.kind === "token_hash" && verification.type === "invite") {
    await acceptCompanyInvitations(supabase);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/**
 * Turns this user's pending membership into "Registered".
 *
 * Called only for `type=invite`, where the recipient had to open a link that
 * was mailed to them — that click *is* the consent the membership model
 * requires. A failure here must not fail the sign-in itself, so it is logged
 * and swallowed; the invitation can also be accepted from `/workspaces`.
 */
async function acceptCompanyInvitations(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  try {
    const { error } = await supabase.rpc("accept_company_invitations");

    if (error) {
      console.error(
        `[auth/callback] Could not accept pending invitations: ${error.message}`,
      );
    }
  } catch (cause) {
    console.error("[auth/callback] Could not accept pending invitations:", cause);
  }
}

/** The parts of a Supabase session that decide the size of the cookie. */
type SessionTokens = {
  access_token: string;
  refresh_token: string;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

/**
 * Re-stores an OAuth session without the provider's tokens.
 *
 * `@supabase/ssr` keeps the whole session object in the auth cookie, chunked at
 * ~3 KB, and a Google session carries two fields the app never reads:
 * `provider_token` (a ~2 KB Google access token) and `provider_refresh_token`.
 * Together they were 2.4 KB of a 5.7 KB payload, which is the difference
 * between two chunks and three — 6.6 KB of `Cookie` header on every subsequent
 * request versus 10 KB.
 *
 * That matters because Node caps request headers at 16 KB
 * (`--max-http-header-size`, which `next dev` inherits) and the browser shares
 * one cookie jar per host, so a local jar that also holds another project's
 * cookies will answer with `431 Request Header Fields Too Large` before this app
 * is ever reached. `setSession` rebuilds the stored object as
 * `{ access_token, refresh_token, user, … }` from the two tokens that *are*
 * used, and auth-js clears the now-unused chunk on its way out.
 *
 * Recover a jar that already overflowed by clearing the site's cookies, or by
 * running `node --max-http-header-size=32768` for the dev server.
 */
async function dropProviderTokens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: SessionTokens | null,
) {
  if (!session || !(session.provider_token || session.provider_refresh_token)) {
    return;
  }

  try {
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    if (error) {
      console.error(
        `[auth/callback] Could not drop the provider tokens from the session: ${error.message}`,
      );
    }
  } catch (cause) {
    // The exchanged session is already stored and valid, it is only larger than
    // it needs to be; failing the sign-in over that would be worse.
    console.error(
      "[auth/callback] Could not drop the provider tokens from the session:",
      cause,
    );
  }
}

/**
 * Verification types Supabase can put in an email link.
 *
 * An unrecognised value falls back to `email`, which is what a `{{ .Token }}`
 * code from the Magic Link template verifies as.
 */
const OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

type OtpType = (typeof OTP_TYPES)[number];

function readOtpType(value: string | null): OtpType {
  return OTP_TYPES.find((type) => type === value) ?? "email";
}

type Verification =
  | { kind: "token_hash"; tokenHash: string; type: OtpType }
  | { kind: "code"; code: string };

/**
 * A `token_hash` wins when both are present: it is what the email template
 * produced, and a bare `code` is worthless without the PKCE cookie that only
 * the browser that started the flow holds.
 */
function readVerification(params: URLSearchParams): Verification | null {
  const tokenHash = params.get("token_hash");
  if (tokenHash) {
    return {
      kind: "token_hash",
      tokenHash,
      type: readOtpType(params.get("type")),
    };
  }

  const code = params.get("code");
  return code ? { kind: "code", code } : null;
}

function loginError(origin: string, message: string) {
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(message)}`,
  );
}
