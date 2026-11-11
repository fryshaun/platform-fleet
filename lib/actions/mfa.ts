"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { readField, type ServerSupabase } from "@/lib/actions/support";
import {
  formatRecoveryCode,
  hasRecoveryCodes,
  MFA_PATH,
  normaliseRecoveryCode,
  RECOVERY_CODES_NAME,
  recoveryCodeProblem,
  TOTP_FACTOR_NAME,
  totpCodeProblem,
  toMfaFactors,
  verifiedTotpFactors,
  type MfaFactor,
} from "@/lib/mfa";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions for the second factor.
 *
 * ## Why these do not use `getSessionContext()`
 *
 * That helper enforces the gate: a session at aal1 with an authenticator is
 * redirected to `/mfa`. These actions are what `/mfa` submits to, so the same
 * check here would answer "go to /mfa" to the person already standing on it.
 * The rule is therefore inverted: these actions authorize themselves with a
 * plain session read, and Supabase refuses anything they are not allowed to do
 * (a wrong code, a factor that is not theirs, a step that needs aal2).
 * `getMfaSession` below is the whole check.
 *
 * ## What is shown once
 *
 * The backup codes and the TOTP secret exist only in the action state: no
 * logging, no URL, no cookie. Once the person navigates away the server no
 * longer has them, which is the point — GoTrue stores only hashes.
 */

/** What the MFA forms render. */
export type MfaFormState = {
  error: string | null;
  notice: string | null;
  /**
   * The unverified factor a scan awaits.
   *
   * `secret` is the manual-entry fallback for somebody whose camera cannot see
   * the QR code; `svg` is the raw markup GoTrue returned, kept raw so the client
   * decides how to wrap it.
   */
  enrollment: { factorId: string; secret: string; svg: string } | null;
  /** Freshly generated backup codes, already formatted for display. */
  codes: string[] | null;
};

/** The state a form starts in, and the shape every failure returns. */
function emptyState(): MfaFormState {
  return { error: null, notice: null, enrollment: null, codes: null };
}

function failure(message: string): MfaFormState {
  return { ...emptyState(), error: message };
}

function success(message: string): MfaFormState {
  return { ...emptyState(), notice: message };
}

/** The bits of an `AuthError` this module reads. */
type AuthErrorLike = { code?: string; message: string; status?: number };

const TOO_MANY_ATTEMPTS =
  "Too many wrong codes. Wait a few minutes before trying again.";

const WRONG_CODE =
  "That code is not right. Codes change every 30 seconds — check the app and try the current one.";

const RECOVERY_CODES_DISABLED =
  "Backup codes are switched off for this project. Turn them on in Supabase under Authentication → Multi-Factor, then try again.";

/**
 * The message for a step that needs the session to be at aal2 first.
 *
 * Deliberately vague about *why*: the two causes are "the factor has not been
 * proved yet" and "the session is older than the change", and both are fixed the
 * same way.
 */
const MFA_STEP_UP_REQUIRED =
  "Confirm a code from your authenticator first, then try again.";

/** GoTrue's machine codes, mapped to something a person can act on. */
const MFA_ERROR_MESSAGES: Record<string, string> = {
  insufficient_aal: MFA_STEP_UP_REQUIRED,
  mfa_factor_not_found:
    "That authenticator is no longer on the account. Refresh the page to see what is left.",
  mfa_verification_failed: WRONG_CODE,
  mfa_verified_factor_exists:
    "This account already has backup codes. Replace them instead of creating a second set.",
  mfa_recovery_codes_sole_factor:
    "Backup codes need an authenticator to fall back from. Add an authenticator app first.",
  mfa_recovery_codes_enroll_not_enabled: RECOVERY_CODES_DISABLED,
  mfa_recovery_codes_verify_not_enabled: RECOVERY_CODES_DISABLED,
  mfa_recovery_codes_locked: TOO_MANY_ATTEMPTS,
  mfa_recovery_codes_factor_not_found:
    "This account has no backup codes yet. Generate a set first.",
  mfa_factor_name_conflict:
    "There is already a half-finished authenticator on this account. Remove it and start again.",
};

/**
 * Turns GoTrue's error into something a person can act on.
 *
 * GoTrue answers MFA failures with a machine code (`mfa_verification_failed`)
 * and a message written for developers, and both describe the wrong thing to
 * change. The codes are mapped first, a few message shapes second, and whatever
 * is left is shown as it came — the same convention the account actions use.
 */
function mfaErrorMessage(error: AuthErrorLike | null): string {
  if (!error) {
    return "That did not work. Try again.";
  }

  const byCode = error.code ? MFA_ERROR_MESSAGES[error.code] : undefined;
  if (byCode) {
    return byCode;
  }

  if (error.status === 429) {
    return TOO_MANY_ATTEMPTS;
  }

  if (
    /invalid.*(totp|otp|code|recovery)|(totp|otp|code).*(invalid|expired)/i.test(
      error.message,
    )
  ) {
    return WRONG_CODE;
  }

  if (/unique|conflict|already exists/i.test(error.message)) {
    return MFA_ERROR_MESSAGES.mfa_factor_name_conflict!;
  }

  if (/not enabled|disabled/i.test(error.message)) {
    return RECOVERY_CODES_DISABLED;
  }

  return error.message;
}

/**
 * A signed-in session, without the gate.
 *
 * See the note at the top of this file: these actions *are* the way past the
 * gate, so they cannot call the helper that sends people to it.
 */
async function getMfaSession(): Promise<{ supabase: ServerSupabase }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(MFA_PATH)}`);
  }

  return { supabase };
}

/** Re-reads the factors for this account, fresh from Auth. */
async function readFactors(
  supabase: ServerSupabase,
): Promise<{ factors: MfaFactor[]; error: string | null }> {
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    return { factors: [], error: mfaErrorMessage(error) };
  }

  return { factors: toMfaFactors(data?.all), error: null };
}

/**
 * Whether the client knows about the backup-code API.
 *
 * It only exists when the client was built with `experimental.recoveryCodes`
 * (see `lib/supabase/server.ts`), and the *server* may also have the feature
 * switched off. Checking here turns "reads a property of undefined" into the
 * same message the server's own `mfa_recovery_codes_enroll_not_enabled` gets.
 */
function recoveryCodesAvailable(supabase: ServerSupabase): boolean {
  return typeof supabase.auth.mfa.recoveryCodes?.generate === "function";
}

/** Best-effort: forget backup codes so they cannot outlive the authenticator. */
async function discardRecoveryCodes(supabase: ServerSupabase): Promise<void> {
  if (!recoveryCodesAvailable(supabase)) {
    return;
  }

  const { error } = await supabase.auth.mfa.recoveryCodes.unenroll();

  if (error) {
    console.error(`[mfa] Could not remove the backup codes: ${error.message}`);
  }
}

/**
 * Removes factors an abandoned attempt left behind.
 *
 * `enroll()` creates the factor *before* anybody scans it, and the friendly name
 * has to be unique — so a person who closed the sheet halfway through would come
 * back to "there is already a factor with that name" and no way forward. Clearing
 * the unverified ones first makes starting over work. Failures are logged and
 * ignored: the conflict error is the worse outcome, and it has its own message.
 */
async function discardUnverifiedTotp(
  supabase: ServerSupabase,
  factors: readonly MfaFactor[],
): Promise<void> {
  for (const factor of factors) {
    if (factor.factorType !== "totp" || factor.status === "verified") {
      continue;
    }

    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });

    if (error) {
      console.error(
        `[mfa] Could not discard an unverified factor: ${error.message}`,
      );
    }
  }
}

/**
 * Removes an authenticator.
 *
 * Supabase requires aal2 for this, which the session has by the time the button
 * is rendered — the gate sends an aal1 session to `/mfa` first. The last
 * authenticator takes the backup codes with it: they are a fallback *for* a
 * factor, and leaving a code that unlocks nothing would be a false promise.
 */
export async function removeTotpFactor(
  _previousState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  const factorId = readField(formData, "factor_id");
  if (!factorId) {
    return failure("That authenticator is no longer on the account.");
  }

  const { factors, error: listError } = await readFactors(supabase);
  if (listError) {
    return failure(listError);
  }

  const target = factors.find(
    (factor) => factor.id === factorId && factor.factorType === "totp",
  );
  if (!target) {
    return failure("That authenticator is no longer on the account.");
  }

  const remaining = factors.filter((factor) => factor.id !== factorId);
  const isLast = verifiedTotpFactors(remaining).length === 0;

  if (isLast && hasRecoveryCodes(factors)) {
    await discardRecoveryCodes(supabase);
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    return failure(mfaErrorMessage(error));
  }

  revalidatePath("/", "layout");

  return success(
    isLast
      ? "Authenticator removed, along with the backup codes that depended on it."
      : "Authenticator removed.",
  );
}

/**
 * Answers the challenge on `/mfa`.
 *
 * The success path redirects, so the person lands on the page they were trying
 * to open — the tenant layout then sees an aal2 session and stops asking.
 */
export async function verifyTotpCode(
  _previousState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  const factorId = readField(formData, "factor_id");
  const code = readField(formData, "code").replace(/\s+/g, "");
  const next = safeNextPath(formData.get("next"));

  if (!factorId) {
    return failure("Reload the page and choose your authenticator again.");
  }

  const problem = totpCodeProblem(code);
  if (problem) {
    return failure(problem);
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });

  if (error) {
    return failure(mfaErrorMessage(error));
  }

  redirect(next);
}

/**
 * Answers the challenge with one of the backup codes instead.
 *
 * The code is normalised before it is sent — GoTrue ignores case and dashes
 * anyway, and doing it here means the same thing is stored in the browser and
 * sent over the wire. A code works exactly once; there is no way to see how many
 * are left from here, which is why the sheet's card is the place to check.
 */
export async function verifyRecoveryCode(
  _previousState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  const raw = readField(formData, "code");
  const next = safeNextPath(formData.get("next"));

  const problem = recoveryCodeProblem(raw);
  if (problem) {
    return failure(problem);
  }

  if (!recoveryCodesAvailable(supabase)) {
    return failure(RECOVERY_CODES_DISABLED);
  }

  const { error } = await supabase.auth.mfa.recoveryCodes.verify({
    code: normaliseRecoveryCode(raw),
  });

  if (error) {
    return failure(mfaErrorMessage(error));
  }

  redirect(next);
}

/**
 * Turns GoTrue's answer into the state that shows the codes.
 *
 * Kept in one place because generate and regenerate differ only in which call
 * makes the codes. A set that comes back empty is treated as a failure rather
 * than as "here are zero codes", which would render a very confusing card.
 */
function codesState(result: {
  data: { codes?: string[] } | null;
  error: AuthErrorLike | null;
}): MfaFormState {
  if (result.error) {
    return failure(mfaErrorMessage(result.error));
  }

  const codes = result.data?.codes ?? [];
  if (codes.length === 0) {
    return failure("No codes came back. Try again.");
  }

  // `formatRecoveryCode` groups them in fours for reading and copying; what the
  // server stored is the unformatted value, which `verify` accepts either way.
  return { ...emptyState(), codes: codes.map(formatRecoveryCode) };
}

/**
 * Starts a TOTP enrolment and hands back what to scan.
 *
 * The factor is created unverified; nothing about the account's security changes
 * until `confirmTotpEnrollment` proves the person's app and the server agree on
 * the secret.
 */
export async function startTotpEnrollment(
  _previousState: MfaFormState,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  const { factors, error: listError } = await readFactors(supabase);
  if (listError) {
    return failure(listError);
  }

  if (verifiedTotpFactors(factors).length > 0) {
    return failure(
      "This account already has an authenticator. Remove it before adding another.",
    );
  }

  await discardUnverifiedTotp(supabase, factors);

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: TOTP_FACTOR_NAME,
  });

  if (error || !data) {
    return failure(mfaErrorMessage(error));
  }

  if (!("totp" in data)) {
    return failure("Only authenticator apps can be set up here.");
  }

  return {
    ...emptyState(),
    enrollment: {
      factorId: data.id,
      secret: data.totp.secret,
      svg: data.totp.qr_code,
    },
  };
}

/**
 * Proves the app was set up correctly, which is what makes the factor real.
 *
 * `challengeAndVerify` creates and answers the challenge in one call, which is
 * all a TOTP needs — the code is generated on demand rather than sent somewhere
 * first. Success promotes *this* session to aal2 and signs out every other
 * session, so the notice says so.
 *
 * A form that carries `next` redirects there once it is done (the forced
 * enrolment at `/mfa/setup`); a form that does not (the account sheet) stays
 * where it is and reports instead.
 */
export async function confirmTotpEnrollment(
  _previousState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  const factorId = readField(formData, "factor_id");
  if (!factorId) {
    return failure("That setup has expired. Start again.");
  }

  const code = readField(formData, "code").replace(/\s+/g, "");
  const problem = totpCodeProblem(code);
  if (problem) {
    return failure(problem);
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });

  if (error) {
    return failure(mfaErrorMessage(error));
  }

  // `getCurrentUser()` carries the factor list, and the rail, the sheet and the
  // gate all read it from the cached tree.
  revalidatePath("/", "layout");

  if (formData.has("next")) {
    redirect(safeNextPath(formData.get("next")));
  }

  return success(
    "Authenticator added. Your other devices have been signed out — sign in again there when you need them.",
  );
}



/**
 * Creates the first set of backup codes.
 *
 * Needs two things the UI arranges for: a confirmed authenticator (codes are
 * never the only factor) and an aal2 session (any session that has just enrolled
 * or challenged one is already there). The codes are returned **once**; GoTrue
 * keeps only hashes, so a lost list means a new one.
 */
export async function generateRecoveryCodes(
  _previousState: MfaFormState,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  if (!recoveryCodesAvailable(supabase)) {
    return failure(RECOVERY_CODES_DISABLED);
  }

  const { factors, error: listError } = await readFactors(supabase);
  if (listError) {
    return failure(listError);
  }

  if (verifiedTotpFactors(factors).length === 0) {
    return failure(MFA_ERROR_MESSAGES.mfa_recovery_codes_sole_factor!);
  }

  const state = codesState(
    await supabase.auth.mfa.recoveryCodes.generate({
      friendlyName: RECOVERY_CODES_NAME,
    }),
  );

  if (state.codes) {
    revalidatePath("/", "layout");
  }

  return state;
}

/**
 * Replaces the set, invalidating every code in the old one immediately.
 *
 * Also the way out of a lockout: regenerating clears whatever wrong-code counter
 * accumulated.
 */
export async function regenerateRecoveryCodes(
  _previousState: MfaFormState,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  if (!recoveryCodesAvailable(supabase)) {
    return failure(RECOVERY_CODES_DISABLED);
  }

  const state = codesState(await supabase.auth.mfa.recoveryCodes.regenerate());

  if (state.codes) {
    revalidatePath("/", "layout");
  }

  return state;
}

/** Removes the backup-code factor and every code in it. */
export async function removeRecoveryCodes(
  _previousState: MfaFormState,
): Promise<MfaFormState> {
  const { supabase } = await getMfaSession();

  if (!recoveryCodesAvailable(supabase)) {
    return failure(RECOVERY_CODES_DISABLED);
  }

  const { error } = await supabase.auth.mfa.recoveryCodes.unenroll();

  if (error) {
    return failure(mfaErrorMessage(error));
  }

  revalidatePath("/", "layout");
  return success(
    "Backup codes removed. Only your authenticator app can unlock this account now.",
  );
}
