/**
 * Two-factor authentication: the rules, shared by the Server Actions and the
 * forms that call them.
 *
 * Framework-free and free of `server-only`, like `lib/auth-policy.ts`, because
 * the browser has to know the same things: how long a code is, where `/mfa`
 * lives, and whether a stage is "prove it" or "set it up". The action remains
 * the authority — Supabase Auth is the thing that actually verifies a code.
 *
 * Nothing here talks to Supabase. The factors are read from the session's user
 * (`user.factors`, which `getUser()` already returns) and the assurance level
 * from `getAuthenticatorAssuranceLevel()`; this module only interprets them.
 *
 * ## The two levels
 *
 * Supabase Auth attaches an `aal` claim to every access token:
 *
 *   aal1 · signed in with one factor — a password, a magic link, Google
 *   aal2 · the same session has since proved a second factor
 *
 * `getAuthenticatorAssuranceLevel()` answers with both the level the session
 * *has* (`currentLevel`) and the level it *could* reach (`nextLevel`, `aal2`
 * whenever a verified factor exists). The gap between the two is precisely
 * "this person has an authenticator and has not used it yet".
 *
 * That claim is decoded from the JWT in the cookie, not verified against the
 * server, so this gate is a **product rule, not an authorization boundary**.
 * Row Level Security remains the boundary: a session that skips `/mfa` by hand
 * still cannot read a row it has no policy for.
 */

// -----------------------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------------------

/** Digits in a TOTP code. Fixed by RFC 6238 and by every authenticator app. */
export const TOTP_CODE_LENGTH = 6;

/**
 * The name given to the factor the app enrols.
 *
 * Stable on purpose: the account sheet shows factors by name, and a name that
 * changed per attempt would leave a trail of half-finished factors behind.
 */
export const TOTP_FACTOR_NAME = "Authenticator app";

/**
 * The name given to the backup-code factor.
 *
 * Like `TOTP_FACTOR_NAME`, stable so the account sheet can tell "there are codes"
 * from "there are not" without asking a second endpoint.
 */
export const RECOVERY_CODES_NAME = "Backup codes";

/** Where a session proves a second factor. */
export const MFA_PATH = "/mfa";

/** Where a session creates one — forced by policy, or by choice. */
export const MFA_SETUP_PATH = "/mfa/setup";

/**
 * One entry of `user.factors`.
 *
 * Narrowed to the fields the app reads so that a Client Component does not have
 * to import the SDK's types, and so a test can build one from a literal.
 */
export type MfaFactor = {
  id: string;
  factorType: string;
  status: string;
  friendlyName: string | null;
};

/**
 * Reads `user.factors` into the app's own shape.
 *
 * `getUser()` returns the factors for the *signed-in* user only, which is why
 * this is a mapping rather than a lookup: there is nothing else to ask.
 */
export function toMfaFactors(factors: unknown): MfaFactor[] {
  if (!Array.isArray(factors)) {
    return [];
  }

  return factors.flatMap((factor): MfaFactor[] => {
    if (typeof factor !== "object" || factor === null) {
      return [];
    }

    const candidate = factor as Record<string, unknown>;
    if (typeof candidate.id !== "string") {
      return [];
    }

    return [
      {
        id: candidate.id,
        factorType:
          typeof candidate.factor_type === "string"
            ? candidate.factor_type
            : "",
        // GoTrue leaves `status` off a factor it has just created; "unverified"
        // is what that means, so the default matches the database.
        status:
          typeof candidate.status === "string"
            ? candidate.status
            : "unverified",
        friendlyName:
          typeof candidate.friendly_name === "string"
            ? candidate.friendly_name
            : null,
      },
    ];
  });
}

/** Whether an account has an authenticator it can actually use. */
export function hasVerifiedTotp(factors: readonly MfaFactor[]): boolean {
  return verifiedTotpFactors(factors).length > 0;
}

/**
 * The authenticators on the account.
 *
 * Both filters matter. `status` keeps a factor that was enrolled but never
 * confirmed out of every decision — verifying one is what proves the app and the
 * server agree on the secret. `factor_type` keeps a set of backup codes from
 * counting as an authenticator: it is a `recovery_code` factor, and Supabase
 * refuses to create one unless a real factor already exists.
 */
export function verifiedTotpFactors(
  factors: readonly MfaFactor[],
): MfaFactor[] {
  return factors.filter(
    (factor) => factor.factorType === "totp" && factor.status === "verified",
  );
}

/** Whether backup codes have been generated for this account. */
export function hasRecoveryCodes(factors: readonly MfaFactor[]): boolean {
  return factors.some(
    (factor) =>
      factor.factorType === "recovery_code" && factor.status === "verified",
  );
}

// -----------------------------------------------------------------------------
// The gate
// -----------------------------------------------------------------------------

/** What a request still has to prove, if anything. */
export type MfaStage = "ok" | "challenge" | "enroll";

export type MfaGate = {
  /** Whether the account has a confirmed authenticator. */
  enrolled: boolean;
  /** The level this session has reached. */
  currentLevel: "aal1" | "aal2" | null;
  /** The level it could reach; `aal2` only when a factor exists. */
  nextLevel: "aal1" | "aal2" | null;
  /** Whether the workspace requires a second factor. */
  required: boolean;
};

/**
 * Decides which of the three stages a request is in.
 *
 *   "ok"        nothing to prove — either the session is already aal2, or the
 *               account has no factor and nothing requires one
 *   "challenge" a factor exists and this session has not used it yet
 *   "enroll"    the workspace requires a second factor and there is none
 *
 * The middle case is Supabase's own predicate, `nextLevel === 'aal2' &&
 * nextLevel !== currentLevel`, with one deviation: `nextLevel` is `null` when
 * the claim cannot be read at all, and "cannot be read" is treated as "expects
 * aal2" rather than as "nothing to prove". Failing towards the challenge is the
 * only direction that cannot let a second factor be skipped.
 *
 * `enrolled` is checked as well as the levels because `currentLevel` comes from
 * an `amr` claim in the token: a session that was aal2 when the factor was
 * removed keeps the claim until the token is refreshed.
 */
export function mfaStage({
  enrolled,
  currentLevel,
  nextLevel,
  required,
}: MfaGate): MfaStage {
  // "aal2" or unreadable: both mean this session is expected to reach aal2.
  if (enrolled && nextLevel !== "aal1" && currentLevel !== "aal2") {
    return "challenge";
  }

  if (!enrolled && required) {
    return "enroll";
  }

  return "ok";
}

/**
 * Where a request in this stage must go, or `null` for "carry on".
 *
 * The target carries the path the person was trying to reach, so proving a
 * factor returns them there instead of dumping everybody on `/workspaces`.
 */
export function mfaRedirect(stage: MfaStage, nextPath: string): string | null {
  if (stage === "challenge") {
    return `${MFA_PATH}?next=${encodeURIComponent(nextPath)}`;
  }

  if (stage === "enroll") {
    return `${MFA_SETUP_PATH}?next=${encodeURIComponent(nextPath)}`;
  }

  return null;
}

// -----------------------------------------------------------------------------
// Codes
// -----------------------------------------------------------------------------

/**
 * The problem with a typed authenticator code, or `null`.
 *
 * Spaces are stripped before the check because apps display codes as "123 456"
 * and people paste them that way. Nothing else is forgiven: a code is six
 * digits, and GoTrue decides whether those digits are right.
 */
export function totpCodeProblem(value: string): string | null {
  const code = value.replace(/\s+/g, "");

  if (code === "") {
    return "Enter the six-digit code from your authenticator app.";
  }

  if (!/^\d+$/.test(code) || code.length !== TOTP_CODE_LENGTH) {
    return `The code is ${TOTP_CODE_LENGTH} digits.`;
  }

  return null;
}

/** Strips the separators people add when they copy a backup code. */
export function normaliseRecoveryCode(value: string): string {
  return value.replace(/[\s-]+/g, "").toLowerCase();
}

/**
 * The problem with a typed backup code, or `null`.
 *
 * Deliberately lenient: GoTrue ignores case, whitespace and dashes, and the
 * alphabet of a code is GoTrue's business, not ours. The only input refused is
 * input that could not be a code at all — too short, too long, or carrying a
 * character that never appears in one. Anything plausible is sent, and the
 * answer comes back as "wrong" rather than as a format complaint.
 */
export function recoveryCodeProblem(value: string): string | null {
  const code = normaliseRecoveryCode(value);

  if (code === "") {
    return "Enter one of the backup codes you saved.";
  }

  if (!/^[a-z0-9]{8,32}$/.test(code)) {
    return "That does not look like a backup code. Check for a typo.";
  }

  return null;
}

/**
 * A backup code as it is shown to the person who generated it: lowercase,
 * grouped in fours — `k4m9-x7qp-2ab8-ht3z`.
 *
 * Display only. What is stored and sent back is the code itself.
 */
export function formatRecoveryCode(value: string): string {
  const code = normaliseRecoveryCode(value);
  return code.replace(/(.{4})/g, "$1-").replace(/-+$/, "");
}

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------

/**
 * The QR code GoTrue returns, as something an `<img src>` will render.
 *
 * `totp.qr_code` is raw SVG markup, not a URL. Encoding it is not optional:
 * SVG is full of `#` (for colours), and a bare `#` starts the fragment of a data
 * URL, so the picture would be truncated at the first fill colour. `utf-8` is
 * the charset the SDK documents.
 */
export function qrCodeDataUrl(svg: string): string {
  if (svg.startsWith("data:")) {
    return svg;
  }

  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}
