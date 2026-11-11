import { describe, expect, it, vi } from "vitest";

import { captureRedirect } from "../helpers/redirect";
import { createSupabaseMock, type SupabaseMock } from "../helpers/supabase";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

const { enforceMfa, mfaStageFor, readAssuranceLevel, redirectAfterSignIn } =
  await import("@/lib/mfa-server");

const TOTP = {
  id: "factor-1",
  factorType: "totp",
  status: "verified",
  friendlyName: "Authenticator app",
};

const CODES = {
  id: "codes",
  factorType: "recovery_code",
  status: "verified",
  friendlyName: "Backup codes",
};

/**
 * A client whose assurance level the test chooses.
 *
 * `mfaStageFor` and friends take the client rather than building one, so nothing
 * has to be mocked beyond `redirect()`.
 */
function clientWith(levels: {
  currentLevel: string | null;
  nextLevel: string | null;
}): { client: SupabaseMock["client"]; level: ReturnType<typeof vi.fn> } {
  const getAuthenticatorAssuranceLevel = vi.fn(async () => ({
    data: levels,
    error: null,
  }));

  const mock = createSupabaseMock({
    auth: { mfa: { getAuthenticatorAssuranceLevel } },
  });

  return { client: mock.client, level: getAuthenticatorAssuranceLevel };
}

describe("readAssuranceLevel", () => {
  it("reads the pair the gate needs", async () => {
    const { client } = clientWith({ currentLevel: "aal1", nextLevel: "aal2" });

    await expect(readAssuranceLevel(client as never)).resolves.toEqual({
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
  });

  it("treats a level this build does not know as no level", async () => {
    // The SDK types the levels as open-ended so a server can add one.
    const { client } = clientWith({ currentLevel: "aal3", nextLevel: "aal2" });

    await expect(readAssuranceLevel(client as never)).resolves.toEqual({
      currentLevel: null,
      nextLevel: "aal2",
    });
  });

  it("reports no level when the token cannot be decoded", async () => {
    const mock = createSupabaseMock({
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn(async () => ({
            data: null,
            error: { message: "JWT not available" },
          })),
        },
      },
    });

    await expect(readAssuranceLevel(mock.client as never)).resolves.toEqual({
      currentLevel: null,
      nextLevel: null,
    });
  });
});

describe("mfaStageFor", () => {
  it("does not read the token when there is nothing to decide", async () => {
    const { client, level } = clientWith({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });

    await expect(
      mfaStageFor(client as never, { factors: [], required: false }),
    ).resolves.toBe("ok");
    expect(level).not.toHaveBeenCalled();
  });

  it("challenges an enrolled session at aal1", async () => {
    const { client } = clientWith({ currentLevel: "aal1", nextLevel: "aal2" });

    await expect(
      mfaStageFor(client as never, { factors: [TOTP], required: false }),
    ).resolves.toBe("challenge");
  });

  it("asks a workspace that requires a factor for one", async () => {
    const { client } = clientWith({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });

    await expect(
      mfaStageFor(client as never, { factors: [CODES], required: true }),
    ).resolves.toBe("enroll");
  });
});

describe("enforceMfa", () => {
  it("sends a challenge to /mfa with the page it came from", async () => {
    const { client } = clientWith({ currentLevel: "aal1", nextLevel: "aal2" });

    const url = await captureRedirect(() =>
      enforceMfa(client as never, {
        factors: [TOTP],
        required: true,
        nextPath: "/acme/dashboard",
      }),
    );

    expect(url).toBe("/mfa?next=%2Facme%2Fdashboard");
  });

  it("sends an enrolment to /mfa/setup", async () => {
    const { client } = clientWith({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });

    const url = await captureRedirect(() =>
      enforceMfa(client as never, {
        factors: [],
        required: true,
        nextPath: "/acme/dashboard",
      }),
    );

    expect(url).toBe("/mfa/setup?next=%2Facme%2Fdashboard");
  });

  it("lets a proved session through", async () => {
    const { client } = clientWith({ currentLevel: "aal2", nextLevel: "aal2" });

    await expect(
      enforceMfa(client as never, {
        factors: [TOTP],
        required: true,
        nextPath: "/acme/dashboard",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("redirectAfterSignIn", () => {
  it("routes a fresh sign-in through /mfa", async () => {
    const { client } = clientWith({ currentLevel: "aal1", nextLevel: "aal2" });

    const url = await captureRedirect(() =>
      redirectAfterSignIn(client as never, "/acme/products"),
    );

    expect(url).toBe("/mfa?next=%2Facme%2Fproducts");
  });

  it("goes straight on when there is no factor", async () => {
    const { client } = clientWith({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });

    const url = await captureRedirect(() =>
      redirectAfterSignIn(client as never, "/acme/products"),
    );

    expect(url).toBe("/acme/products");
  });

  it("does not nest the challenge page inside itself", async () => {
    const { client } = clientWith({ currentLevel: "aal1", nextLevel: "aal2" });

    const url = await captureRedirect(() =>
      redirectAfterSignIn(client as never, "/mfa"),
    );

    expect(url).toBe("/mfa");
  });

  it("refuses a next value that is not a path on this site", async () => {
    const { client } = clientWith({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });

    const url = await captureRedirect(() =>
      redirectAfterSignIn(client as never, "//evil.example.com"),
    );

    expect(url).toBe("/workspaces");
  });
});
