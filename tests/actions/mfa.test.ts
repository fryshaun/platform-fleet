import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { formDataOf } from "../helpers/fixtures";
import { captureRedirect } from "../helpers/redirect";
import {
  createSupabaseMock,
  signedInUser,
  signedOutUser,
  type SupabaseMock,
} from "../helpers/supabase";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: cacheMock.revalidatePath,
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const {
  confirmTotpEnrollment,
  generateRecoveryCodes,
  regenerateRecoveryCodes,
  removeRecoveryCodes,
  removeTotpFactor,
  startTotpEnrollment,
  verifyRecoveryCode,
  verifyTotpCode,
} = await import("@/lib/actions/mfa");

const EMPTY = { error: null, notice: null, enrollment: null, codes: null };

/** The slice of `auth.mfa` the actions call, typed for assertions. */
type MfaMock = {
  enroll: Mock;
  challengeAndVerify: Mock;
  unenroll: Mock;
  listFactors: Mock;
  recoveryCodes: {
    generate: Mock;
    regenerate: Mock;
    verify: Mock;
    unenroll: Mock;
  };
};

/** A factor in the shape GoTrue returns it. */
function factorRow(
  overrides: {
    id?: string;
    factor_type?: string;
    status?: string;
    friendly_name?: string;
  } = {},
) {
  return {
    id: "factor-1",
    factor_type: "totp",
    status: "verified",
    friendly_name: "Authenticator app",
    ...overrides,
  };
}

type SetupOptions = {
  signedIn?: boolean;
  /** What `listFactors()` answers with. */
  factors?: ReturnType<typeof factorRow>[];
  /** Overrides merged into the `auth.mfa` stub, one level deep. */
  mfa?: Record<string, unknown>;
};

/**
 * A signed-in session and the MFA surface.
 *
 * The actions read the factors through `listFactors()` rather than trusting the
 * page, so that is the knob most tests turn.
 */
function setup(options: SetupOptions = {}) {
  const listFactors = vi.fn(async () => ({
    data: { all: options.factors ?? [], totp: [], phone: [] },
    error: null,
  }));

  const mock = createSupabaseMock({
    auth: {
      getUser: vi.fn(async () =>
        options.signedIn === false ? signedOutUser() : signedInUser(),
      ),
      mfa: { listFactors, ...options.mfa },
    },
  });

  serverMock.createClient.mockResolvedValue(mock.client);

  return { mock, mfa: mfaOf(mock) };
}

/** `auth.mfa` with the shapes the assertions need. */
function mfaOf(mock: SupabaseMock): MfaMock {
  return mock.client.auth.mfa as unknown as MfaMock;
}

beforeEach(() => {
  cacheMock.revalidatePath.mockReset();
});

describe("startTotpEnrollment", () => {
  it("creates an unverified factor and hands back what to scan", async () => {
    const { mfa } = setup();

    const state = await startTotpEnrollment(EMPTY);

    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    expect(state.error).toBeNull();
    expect(state.enrollment).toEqual({
      factorId: "factor-1",
      secret: "JBSWY3DPEHPK3PXP",
      svg: expect.stringContaining("<svg"),
    });
  });

  it("clears a half-finished attempt before starting another", async () => {
    // The friendly name is stable, so a leftover unverified factor would make the
    // next `enroll()` fail with a name conflict — and leave the person stuck.
    const { mfa } = setup({
      factors: [factorRow({ id: "stale", status: "unverified" })],
    });

    await startTotpEnrollment(EMPTY);

    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(mfa.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.enroll.mock.invocationCallOrder[0]!,
    );
  });

  it("refuses to add a second authenticator", async () => {
    const { mfa } = setup({ factors: [factorRow()] });

    const state = await startTotpEnrollment(EMPTY);

    expect(state.error).toContain("already has an authenticator");
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it("explains a name clash instead of repeating it", async () => {
    const { mfa } = setup({
      mfa: {
        enroll: vi.fn(async () => ({
          data: null,
          error: {
            code: "mfa_factor_name_conflict",
            message: "A factor with this friendly name already exists",
          },
        })),
      },
    });

    const state = await startTotpEnrollment(EMPTY);

    expect(state.error).toContain("half-finished authenticator");
    expect(mfa.enroll).toHaveBeenCalled();
  });

  it("sends a signed-out visitor back to sign in", async () => {
    setup({ signedIn: false });

    const url = await captureRedirect(() => startTotpEnrollment(EMPTY));

    expect(url).toBe("/login?next=%2Fmfa");
  });
});

describe("confirmTotpEnrollment", () => {
  it("verifies the factor and warns that other devices were signed out", async () => {
    const { mfa } = setup();

    const state = await confirmTotpEnrollment(
      EMPTY,
      formDataOf({ factor_id: "factor-1", code: "123 456" }),
    );

    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "factor-1",
      code: "123456",
    });
    expect(state.error).toBeNull();
    expect(state.notice).toContain("other devices");
    // The factor list lives in the cached `getCurrentUser()` payload.
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a code that is not six digits before calling Auth", async () => {
    const { mfa } = setup();

    const state = await confirmTotpEnrollment(
      EMPTY,
      formDataOf({ factor_id: "factor-1", code: "12" }),
    );

    expect(state.error).toBe("The code is 6 digits.");
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("returns to the page that required the enrolment", async () => {
    setup();

    const url = await captureRedirect(() =>
      confirmTotpEnrollment(
        EMPTY,
        formDataOf({
          factor_id: "factor-1",
          code: "123456",
          next: "/acme/products",
        }),
      ),
    );

    expect(url).toBe("/acme/products");
  });

  it("does not follow a next value off the site", async () => {
    setup();

    const url = await captureRedirect(() =>
      confirmTotpEnrollment(
        EMPTY,
        formDataOf({
          factor_id: "factor-1",
          code: "123456",
          next: "https://evil.example.com",
        }),
      ),
    );

    expect(url).toBe("/workspaces");
  });

  it("turns a wrong code into a sentence", async () => {
    setup({
      mfa: {
        challengeAndVerify: vi.fn(async () => ({
          data: null,
          error: {
            code: "mfa_verification_failed",
            message: "Invalid TOTP code entered",
          },
        })),
      },
    });

    const state = await confirmTotpEnrollment(
      EMPTY,
      formDataOf({ factor_id: "factor-1", code: "000000" }),
    );

    expect(state.error).toContain("not right");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("verifyTotpCode", () => {
  it("answers the challenge and lands on the page that was asked for", async () => {
    const { mfa } = setup();

    const url = await captureRedirect(() =>
      verifyTotpCode(
        EMPTY,
        formDataOf({
          factor_id: "factor-1",
          code: "123456",
          next: "/acme/dashboard",
        }),
      ),
    );

    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "factor-1",
      code: "123456",
    });
    expect(url).toBe("/acme/dashboard");
  });

  it("asks for the form again when the factor id is missing", async () => {
    const { mfa } = setup();

    const state = await verifyTotpCode(EMPTY, formDataOf({ code: "123456" }));

    expect(state.error).toContain("Reload the page");
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("reports a code that Auth rejects without redirecting", async () => {
    setup({
      mfa: {
        challengeAndVerify: vi.fn(async () => ({
          data: null,
          error: { message: "Invalid TOTP code entered" },
        })),
      },
    });

    const state = await verifyTotpCode(
      EMPTY,
      formDataOf({ factor_id: "factor-1", code: "111111" }),
    );

    expect(state.error).toContain("not right");
  });
});

describe("verifyRecoveryCode", () => {
  it("normalises the code and signs the session in", async () => {
    const { mfa } = setup();

    const url = await captureRedirect(() =>
      verifyRecoveryCode(
        EMPTY,
        formDataOf({ code: " K4M9-X7QP 2AB8 ", next: "/acme" }),
      ),
    );

    expect(mfa.recoveryCodes.verify).toHaveBeenCalledWith({
      code: "k4m9x7qp2ab8",
    });
    expect(url).toBe("/acme");
  });

  it("refuses input that could not be a code", async () => {
    const { mfa } = setup();

    const state = await verifyRecoveryCode(EMPTY, formDataOf({ code: "abc" }));

    expect(state.error).toContain("does not look like");
    expect(mfa.recoveryCodes.verify).not.toHaveBeenCalled();
  });

  it("says so when backup codes are switched off", async () => {
    setup({
      mfa: {
        recoveryCodes: {
          verify: vi.fn(async () => ({
            data: null,
            error: {
              code: "mfa_recovery_codes_verify_not_enabled",
              message: "Recovery codes are not enabled",
            },
          })),
        },
      },
    });

    const state = await verifyRecoveryCode(
      EMPTY,
      formDataOf({ code: "abcd1234efgh" }),
    );

    expect(state.error).toContain("switched off for this project");
  });

  it("reports a lockout as a wait", async () => {
    setup({
      mfa: {
        recoveryCodes: {
          verify: vi.fn(async () => ({
            data: null,
            error: { status: 429, message: "Too many requests" },
          })),
        },
      },
    });

    const state = await verifyRecoveryCode(
      EMPTY,
      formDataOf({ code: "abcd1234efgh" }),
    );

    expect(state.error).toContain("Too many wrong codes");
  });
});


describe("removeTotpFactor", () => {
  it("removes the factor and revalidates the tree", async () => {
    // Two authenticators, so this one is not the last and the notice stays short.
    const { mfa } = setup({
      factors: [factorRow({ id: "factor-1" }), factorRow({ id: "factor-2" })],
    });

    const state = await removeTotpFactor(
      EMPTY,
      formDataOf({ factor_id: "factor-1" }),
    );

    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(state.notice).toBe("Authenticator removed.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("takes the backup codes with the last authenticator", async () => {
    // Codes are a fallback *for* a factor; leaving a set that unlocks nothing
    // would be a promise the app cannot keep.
    const { mfa } = setup({
      factors: [factorRow(), factorRow({ id: "codes", factor_type: "recovery_code" })],
    });

    const state = await removeTotpFactor(
      EMPTY,
      formDataOf({ factor_id: "factor-1" }),
    );

    expect(mfa.recoveryCodes.unenroll).toHaveBeenCalled();
    expect(state.notice).toContain("backup codes");
  });

  it("leaves the codes when another authenticator remains", async () => {
    const { mfa } = setup({
      factors: [
        factorRow({ id: "factor-1" }),
        factorRow({ id: "factor-2" }),
        factorRow({ id: "codes", factor_type: "recovery_code" }),
      ],
    });

    const state = await removeTotpFactor(
      EMPTY,
      formDataOf({ factor_id: "factor-1" }),
    );

    expect(mfa.recoveryCodes.unenroll).not.toHaveBeenCalled();
    expect(state.notice).toBe("Authenticator removed.");
  });

  it("will not touch a factor that is not an authenticator", async () => {
    const { mfa } = setup({
      factors: [factorRow({ id: "codes", factor_type: "recovery_code" })],
    });

    const state = await removeTotpFactor(
      EMPTY,
      formDataOf({ factor_id: "codes" }),
    );

    expect(state.error).toContain("no longer on the account");
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });
});

describe("generateRecoveryCodes", () => {
  it("returns the codes grouped for reading", async () => {
    const { mfa } = setup({ factors: [factorRow()] });

    const state = await generateRecoveryCodes(EMPTY);

    expect(mfa.recoveryCodes.generate).toHaveBeenCalledWith({
      friendlyName: "Backup codes",
    });
    expect(state.codes).toEqual(["abcd-1234-efgh", "ijkl-5678-mnop"]);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses when there is no authenticator to fall back from", async () => {
    const { mfa } = setup();

    const state = await generateRecoveryCodes(EMPTY);

    expect(state.error).toContain("need an authenticator");
    expect(mfa.recoveryCodes.generate).not.toHaveBeenCalled();
  });

  it("points at Replace when a set already exists", async () => {
    setup({
      factors: [factorRow()],
      mfa: {
        recoveryCodes: {
          generate: vi.fn(async () => ({
            data: null,
            error: {
              code: "mfa_verified_factor_exists",
              message: "A recovery code factor already exists",
            },
          })),
        },
      },
    });

    const state = await generateRecoveryCodes(EMPTY);

    expect(state.error).toContain("Replace them");
  });
});

describe("regenerateRecoveryCodes", () => {
  it("hands back the new set", async () => {
    const { mfa } = setup({ factors: [factorRow()] });

    const state = await regenerateRecoveryCodes(EMPTY);

    expect(mfa.recoveryCodes.regenerate).toHaveBeenCalled();
    expect(state.codes).toEqual(["qrst-9012-uvwx", "yzab-3456-cdef"]);
  });
});

describe("removeRecoveryCodes", () => {
  it("says what is left when the codes are gone", async () => {
    const { mfa } = setup({ factors: [factorRow()] });

    const state = await removeRecoveryCodes(EMPTY);

    expect(mfa.recoveryCodes.unenroll).toHaveBeenCalled();
    expect(state.notice).toContain("Only your authenticator app");
  });
});

