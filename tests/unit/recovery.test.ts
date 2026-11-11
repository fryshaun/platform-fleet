import { beforeEach, describe, expect, it, vi } from "vitest";

/** The slice of Next's cookie store `lib/recovery` touches. */
const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const {
  RECOVERY_COOKIE,
  closeRecoveryWindow,
  isRecoveryWindowOpen,
  openRecoveryWindow,
} = await import("@/lib/recovery");

/** The options `openRecoveryWindow` passed to `set`. */
function writtenOptions(): Record<string, unknown> {
  return cookieStore.set.mock.calls[0]?.[2] as Record<string, unknown>;
}

beforeEach(() => {
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
});

describe("openRecoveryWindow", () => {
  it("writes the marker for the reset page only", async () => {
    await openRecoveryWindow();

    expect(cookieStore.set).toHaveBeenCalledWith(RECOVERY_COOKIE, "1", expect.anything());

    // Path-scoped so no other route carries the proof, httpOnly so script
    // cannot read or forge it, and short-lived so it does not outstay the visit.
    const options = writtenOptions();
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/reset-password",
    });
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("omits `secure` over http, where the browser would drop the cookie", async () => {
    await openRecoveryWindow();

    expect(writtenOptions().secure).toBe(false);
  });

  it("sets `secure` in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await openRecoveryWindow();

    expect(writtenOptions().secure).toBe(true);
  });
});

describe("isRecoveryWindowOpen", () => {
  it("reads the marker", async () => {
    cookieStore.get.mockReturnValue({ name: RECOVERY_COOKIE, value: "1" });

    expect(await isRecoveryWindowOpen()).toBe(true);
    expect(cookieStore.get).toHaveBeenCalledWith(RECOVERY_COOKIE);
  });

  it.each([undefined, { name: RECOVERY_COOKIE, value: "0" }])(
    "treats anything else as closed: %s",
    async (cookie) => {
      cookieStore.get.mockReturnValue(cookie);

      expect(await isRecoveryWindowOpen()).toBe(false);
    },
  );
});

describe("closeRecoveryWindow", () => {
  it("expires the marker at the path it was written to", async () => {
    await closeRecoveryWindow();

    // `delete()` would expire the cookie at `/`, which is not where it lives.
    expect(cookieStore.set).toHaveBeenCalledWith(
      RECOVERY_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/reset-password" }),
    );
  });
});
