import "server-only";

import { redirect } from "next/navigation";

import {
  hasVerifiedTotp,
  mfaRedirect,
  MFA_PATH,
  mfaStage,
  type MfaFactor,
  type MfaStage,
} from "@/lib/mfa";
import { safeNextPath } from "@/lib/safe-redirect";
import type { createClient } from "@/lib/supabase/server";

/**
 * The server half of two-factor authentication.
 *
 * Separate from `lib/mfa.ts` because this file reads a cookie and calls
 * `redirect()`, and the browser copy has to stay importable from a Client
 * Component. Separate from `lib/actions/mfa.ts` because these are helpers, not
 * actions: an exported function in a `"use server"` module becomes an endpoint,
 * and none of these take arguments a client could send.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

type AssuranceLevel = "aal1" | "aal2";

/**
 * Narrows the SDK's `AuthenticatorAssuranceLevels`.
 *
 * That type is `"aal1" | "aal2" | (string & {})` — open, so a future server can
 * add a level without breaking clients. Anything the app does not know is
 * reported as "no level", which `mfaStage` reads as "not aal2" and therefore as
 * "still has something to prove". Failing towards the challenge, never past it.
 */
function toAssuranceLevel(value: unknown): AssuranceLevel | null {
  return value === "aal1" || value === "aal2" ? value : null;
}

export type Assurance = {
  currentLevel: AssuranceLevel | null;
  nextLevel: AssuranceLevel | null;
};

/**
 * The level this session has reached, and the level it could reach.
 *
 * `nextLevel` is `aal2` exactly when the account has a verified factor, so the
 * pair answers both questions at once. The SDK decodes the `aal` claim from the
 * JWT in the cookie rather than calling the server, which is what makes it cheap
 * enough to ask on every request — and why it is a product rule rather than a
 * boundary (see `lib/mfa.ts`).
 *
 * A failure is reported as "no level", which leaves the gate in whatever state
 * the account's factors say. That is deliberately permissive: a signed-in person
 * whose claim cannot be read is better served by the app than by a redirect
 * loop.
 */
export async function readAssuranceLevel(
  supabase: Supabase,
): Promise<Assurance> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error) {
    console.error(
      `[mfa] Could not read the assurance level: ${error.message}`,
    );
    return { currentLevel: null, nextLevel: null };
  }

  return {
    currentLevel: toAssuranceLevel(data?.currentLevel),
    nextLevel: toAssuranceLevel(data?.nextLevel),
  };
}

/**
 * Which of the three stages this request is in.
 *
 * The assurance level is only read when there is something it could change: an
 * account with no factor in a workspace that does not require one is "ok"
 * whatever the cookie says, and asking anyway would spend a decode per request
 * to learn nothing.
 */
export async function mfaStageFor(
  supabase: Supabase,
  options: { factors: readonly MfaFactor[]; required: boolean },
): Promise<MfaStage> {
  const enrolled = hasVerifiedTotp(options.factors);

  if (!enrolled && !options.required) {
    return "ok";
  }

  const { currentLevel, nextLevel } = await readAssuranceLevel(supabase);

  return mfaStage({
    enrolled,
    currentLevel,
    nextLevel,
    required: options.required,
  });
}

/**
 * Sends the request to `/mfa` or `/mfa/setup` when the stage is not "ok".
 *
 * Called from the data access layer, not from the proxy: the proxy works from
 * the cookie and the URL alone, while deciding "does this workspace require a
 * second factor" needs the company row. It is also the difference between a
 * redirect that can explain itself and a 403 a page cannot.
 */
export async function enforceMfa(
  supabase: Supabase,
  options: {
    factors: readonly MfaFactor[];
    required: boolean;
    /** Where to come back to once the factor is proved. */
    nextPath: string;
  },
): Promise<void> {
  const stage = await mfaStageFor(supabase, options);
  const target = mfaRedirect(stage, options.nextPath);

  if (target) {
    redirect(target);
  }
}

/**
 * Where a just-signed-in browser should land.
 *
 * Split out from `redirectAfterSignIn` because a Route Handler answers with a
 * `NextResponse.redirect(...)` rather than calling `redirect()` — the latter
 * throws, which is a Server Action's way of navigating and a route's way of
 * failing.
 *
 * A person with an authenticator lands on `/mfa` first, carrying the path they
 * were going to; everyone else is returned to it directly. Called by every
 * sign-in that produces a session: the password action, the emailed one-time
 * code, and the OAuth/email callback. Without it somebody with two-factor
 * authentication would sign in at aal1 and only be asked for a code when they
 * opened a workspace, which reads as "the code is optional until you go
 * somewhere".
 */
export async function signInLandingPath(
  supabase: Supabase,
  nextPath: string,
): Promise<string> {
  const next = safeNextPath(nextPath);

  // A `next` that already points at the MFA screens is left alone: the
  // challenge page's own form posts to an action, but a stale bookmark of `/mfa`
  // should not become `/mfa?next=/mfa`.
  if (next === MFA_PATH || next.startsWith(`${MFA_PATH}?`)) {
    return next;
  }

  const { currentLevel, nextLevel } = await readAssuranceLevel(supabase);

  // Supabase's own predicate: the session can reach aal2 and has not.
  if (nextLevel === "aal2" && currentLevel !== "aal2") {
    return `${MFA_PATH}?next=${encodeURIComponent(next)}`;
  }

  return next;
}

/** `signInLandingPath`, as a Server Action uses it. */
export async function redirectAfterSignIn(
  supabase: Supabase,
  nextPath: string,
): Promise<never> {
  redirect(await signInLandingPath(supabase, nextPath));
}
