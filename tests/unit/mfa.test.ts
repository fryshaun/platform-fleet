import { describe, expect, it } from "vitest";

import {
  formatRecoveryCode,
  hasRecoveryCodes,
  hasVerifiedTotp,
  MFA_PATH,
  MFA_SETUP_PATH,
  mfaRedirect,
  mfaStage,
  normaliseRecoveryCode,
  qrCodeDataUrl,
  recoveryCodeProblem,
  toMfaFactors,
  totpCodeProblem,
  verifiedTotpFactors,
  type MfaFactor,
} from "@/lib/mfa";

/** A factor as `lib/mfa.ts` holds one. */
function factor(overrides: Partial<MfaFactor> = {}): MfaFactor {
  return {
    id: "factor-1",
    factorType: "totp",
    status: "verified",
    friendlyName: "Authenticator app",
    ...overrides,
  };
}

describe("toMfaFactors", () => {
  it("reads the shape GoTrue returns", () => {
    expect(
      toMfaFactors([
        {
          id: "f1",
          factor_type: "totp",
          status: "verified",
          friendly_name: "Authenticator app",
        },
      ]),
    ).toEqual([
      {
        id: "f1",
        factorType: "totp",
        status: "verified",
        friendlyName: "Authenticator app",
      },
    ]);
  });

  it("defaults a factor with no status to unverified", () => {
    // A factor exists from the moment `enroll()` creates it, before anybody has
    // scanned anything — and GoTrue leaves `status` off until it is verified.
    expect(toMfaFactors([{ id: "f1", factor_type: "totp" }])[0]?.status).toBe(
      "unverified",
    );
  });

  it("ignores anything without an id", () => {
    expect(toMfaFactors([null, "totp", {}, { id: "f1" }])).toHaveLength(1);
    expect(toMfaFactors(undefined)).toEqual([]);
    expect(toMfaFactors("nope")).toEqual([]);
  });
});

describe("verifiedTotpFactors", () => {
  it("keeps confirmed authenticators only", () => {
    const factors = [
      factor({ id: "verified" }),
      factor({ id: "unverified", status: "unverified" }),
      factor({ id: "codes", factorType: "recovery_code" }),
    ];

    expect(verifiedTotpFactors(factors).map((entry) => entry.id)).toEqual([
      "verified",
    ]);
    expect(hasVerifiedTotp(factors)).toBe(true);
  });

  it("does not let backup codes count as an authenticator", () => {
    // `recovery_code` is a factor type of its own, and GoTrue refuses to create
    // one unless a real factor already exists. Treating it as one would let a
    // person "sign in with two factors" that are both the same thing.
    expect(hasVerifiedTotp([factor({ factorType: "recovery_code" })])).toBe(
      false,
    );
  });
});

describe("hasRecoveryCodes", () => {
  it("looks for a verified recovery_code factor", () => {
    expect(hasRecoveryCodes([factor({ factorType: "recovery_code" })])).toBe(
      true,
    );
    expect(hasRecoveryCodes([factor()])).toBe(false);
    expect(
      hasRecoveryCodes([
        factor({ factorType: "recovery_code", status: "unverified" }),
      ]),
    ).toBe(false);
  });
});

describe("mfaStage", () => {
  it("challenges a session that has a factor and has not proved it", () => {
    expect(
      mfaStage({
        enrolled: true,
        currentLevel: "aal1",
        nextLevel: "aal2",
        required: false,
      }),
    ).toBe("challenge");
  });

  it("lets a session that has proved its factor through", () => {
    expect(
      mfaStage({
        enrolled: true,
        currentLevel: "aal2",
        nextLevel: "aal2",
        required: true,
      }),
    ).toBe("ok");
  });

  it("asks for enrolment when the workspace requires a factor and there is none", () => {
    expect(
      mfaStage({
        enrolled: false,
        currentLevel: "aal1",
        nextLevel: "aal1",
        required: true,
      }),
    ).toBe("enroll");
  });

  it("does not ask for enrolment when nothing requires it", () => {
    expect(
      mfaStage({
        enrolled: false,
        currentLevel: "aal1",
        nextLevel: "aal1",
        required: false,
      }),
    ).toBe("ok");
  });

  it("trusts the factor list over a stale aal2 claim", () => {
    // Removing the last factor leaves `amr` at aal2 until the token refreshes.
    // There is nothing left to challenge, so the enrolment rule decides.
    expect(
      mfaStage({
        enrolled: false,
        currentLevel: "aal2",
        nextLevel: "aal2",
        required: true,
      }),
    ).toBe("enroll");
  });

  it("challenges when the level cannot be read at all", () => {
    // Fail towards the challenge: a token whose claim cannot be decoded has not
    // proved anything.
    expect(
      mfaStage({
        enrolled: true,
        currentLevel: null,
        nextLevel: null,
        required: false,
      }),
    ).toBe("challenge");
  });
});

describe("mfaRedirect", () => {
  it("sends a challenge to /mfa and an enrolment to /mfa/setup", () => {
    expect(mfaRedirect("challenge", "/acme/dashboard")).toBe(
      `${MFA_PATH}?next=%2Facme%2Fdashboard`,
    );
    expect(mfaRedirect("enroll", "/acme/dashboard")).toBe(
      `${MFA_SETUP_PATH}?next=%2Facme%2Fdashboard`,
    );
  });

  it("returns nothing to do for a satisfied session", () => {
    expect(mfaRedirect("ok", "/acme/dashboard")).toBeNull();
  });
});

describe("totpCodeProblem", () => {
  it("accepts six digits, spaced or not", () => {
    expect(totpCodeProblem("123456")).toBeNull();
    expect(totpCodeProblem("123 456")).toBeNull();
  });

  it("explains an empty or malformed code", () => {
    expect(totpCodeProblem("")).toContain("six-digit");
    expect(totpCodeProblem("12345")).toBe("The code is 6 digits.");
    expect(totpCodeProblem("1234567")).toBe("The code is 6 digits.");
    expect(totpCodeProblem("12345a")).toBe("The code is 6 digits.");
  });
});

describe("recovery codes", () => {
  it("normalises case and separators", () => {
    expect(normaliseRecoveryCode(" K4M9-X7QP 2AB8 ")).toBe("k4m9x7qp2ab8");
  });

  it("accepts what a person is likely to paste", () => {
    expect(recoveryCodeProblem("abcd1234efgh")).toBeNull();
    expect(recoveryCodeProblem("ABCD-1234-EFGH")).toBeNull();
    expect(recoveryCodeProblem(" abcd 1234 efgh ")).toBeNull();
  });

  it("refuses only what could not be a code", () => {
    expect(recoveryCodeProblem("")).toContain("Enter one");
    expect(recoveryCodeProblem("abc")).toContain("does not look like");
    expect(recoveryCodeProblem("abcd 1234 efgh!")).toContain(
      "does not look like",
    );
    expect(recoveryCodeProblem("a".repeat(33))).toContain("does not look like");
  });

  it("groups a code in fours for reading, without changing it", () => {
    expect(formatRecoveryCode("abcd1234efgh")).toBe("abcd-1234-efgh");
    expect(formatRecoveryCode("ABCD-1234-EFGH")).toBe("abcd-1234-efgh");
    // Stripping the dashes gets back exactly what the server stored.
    expect(normaliseRecoveryCode(formatRecoveryCode("abcd1234efgh"))).toBe(
      "abcd1234efgh",
    );
  });
});

describe("qrCodeDataUrl", () => {
  it("encodes raw SVG markup", () => {
    const url = qrCodeDataUrl('<svg fill="#000"></svg>');

    expect(url.startsWith("data:image/svg+xml;utf-8,")).toBe(true);
    // The `#` of a fill colour would otherwise start the URL's fragment and
    // truncate the picture.
    expect(url).not.toContain("#000");
    expect(decodeURIComponent(url.split(",")[1] ?? "")).toBe(
      '<svg fill="#000"></svg>',
    );
  });

  it("leaves a value that is already a data URL alone", () => {
    expect(qrCodeDataUrl("data:image/svg+xml;base64,AAA")).toBe(
      "data:image/svg+xml;base64,AAA",
    );
  });
});

