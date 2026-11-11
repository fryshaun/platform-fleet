import "server-only";

import { cookies } from "next/headers";

/**
 * Marks the browser that opened a password-recovery link.
 *
 * `/auth/callback` verifies the `type=recovery` token and *then* writes this
 * cookie, so `/reset-password` can tell "arrived from the email" apart from
 * "somebody typed the address while signed in". Without it the page would let
 * any session replace a password without proving knowledge of the old one,
 * which is exactly what `changePassword` refuses to do.
 *
 * It is a marker, not a password: it is not a security boundary. Supabase's own
 * `PUT /user` lets any holder of a session set a password, so an attacker with
 * the session cookie can bypass this either way; what the cookie buys is that
 * the ordinary path — a signed-in person opening `/reset-password` directly, or
 * a stale bookmark — cannot silently skip the old password.
 */
export const RECOVERY_COOKIE = "platform-recovery";

/**
 * Scoped to the one page that can use it. A Server Action posts to the route it
 * was rendered on, so the action still receives it, while every other request
 * in the app does not.
 */
const RECOVERY_PATH = "/reset-password";

/**
 * Long enough to read the page and type a password twice; short enough that a
 * browser left open does not keep the permission around.
 */
const RECOVERY_WINDOW_SECONDS = 10 * 60;

/**
 * `httpOnly` keeps the browser from reading or forging it with script;
 * `sameSite=lax` still lets the link's top-level navigation land with it;
 * `secure` is skipped on `http://localhost`, where the cookie would be dropped.
 */
function recoveryCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: RECOVERY_PATH,
    maxAge: RECOVERY_WINDOW_SECONDS,
  };
}

/** Called by the callback once a recovery token has been verified. */
export async function openRecoveryWindow(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE, "1", recoveryCookieOptions());
}

/** Whether this browser may set a password without the current one. */
export async function isRecoveryWindowOpen(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(RECOVERY_COOKIE)?.value === "1";
}

/**
 * Spends the proof, so the same page cannot be reloaded and used again.
 *
 * `cookies().delete(name)` expires the cookie at path `/`, which does not match
 * a cookie scoped to `/reset-password`; writing an empty value with the same
 * options and `maxAge: 0` does.
 */
export async function closeRecoveryWindow(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE, "", {
    ...recoveryCookieOptions(),
    maxAge: 0,
  });
}
