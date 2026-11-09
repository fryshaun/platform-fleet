/**
 * Auth rules shared by the Server Actions and the client forms.
 *
 * Kept free of `server-only`, `next/headers` and Supabase imports so that a
 * client component can enforce the same limits the action will apply. The
 * action is still the authority: the browser value is only there to fail fast.
 */

/** Shortest password accepted at sign-up. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Digits in the one-time code Supabase emails alongside a magic link.
 *
 * The code only exists if the project's **Magic Link** email template includes
 * `{{ .Token }}`; otherwise users verify by clicking the link.
 */
export const OTP_LENGTH = 6;
