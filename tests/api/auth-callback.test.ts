import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const { GET } = await import("@/app/auth/callback/route");

/** Only `nextUrl` is touched by the handler. */
function callback(query: string): NextRequest {
  return {
    nextUrl: new URL(`https://platform.example.com/auth/callback${query}`),
  } as unknown as NextRequest;
}

function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

function queryOf(response: Response): URLSearchParams {
  return new URL(locationOf(response)).searchParams;
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    serverMock.createClient.mockReset();
    serverMock.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
      },
      rpc: vi.fn(async () => ({ data: 0, error: null })),
    });
  });

  describe("invitation acceptance", () => {
    /** A client whose email-link verification succeeds. */
    function clientWithOtp(rpc: ReturnType<typeof vi.fn>) {
      return {
        auth: {
          verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
        },
        rpc,
      };
    }

    it("accepts a pending invitation when the invitation link is opened", async () => {
      const rpc = vi.fn(async () => ({ data: 1, error: null }));
      serverMock.createClient.mockResolvedValue(clientWithOtp(rpc));

      await GET(callback("?token_hash=abc&type=invite"));

      // The link was mailed to the invitee, so opening it is the consent a
      // pending membership is waiting for.
      expect(rpc).toHaveBeenCalledWith("accept_company_invitations");
    });

    it.each([
      ["a signup confirmation", "?token_hash=abc&type=signup"],
      ["a magic link", "?token_hash=abc&type=magiclink"],
      ["an OAuth sign-in", "?code=abc"],
    ])("does not accept invitations after %s", async (_label, query) => {
      const rpc = vi.fn();
      serverMock.createClient.mockResolvedValue({
        ...clientWithOtp(rpc),
        auth: {
          verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
          exchangeCodeForSession: vi.fn(async () => ({
            data: {},
            error: null,
          })),
        },
      });

      await GET(callback(query));

      // Signing in is not consent to join somebody else's workspace.
      expect(rpc).not.toHaveBeenCalled();
    });

    it("does not touch invitations when verification failed", async () => {
      const rpc = vi.fn();
      serverMock.createClient.mockResolvedValue({
        auth: {
          verifyOtp: vi.fn(async () => ({
            data: {},
            error: { message: "token expired" },
          })),
        },
        rpc,
      });

      await GET(callback("?token_hash=abc&type=invite"));

      expect(rpc).not.toHaveBeenCalled();
    });

    it("still completes the sign-in when accepting invitations fails", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const rpc = vi.fn(async () => ({
        data: null,
        error: { message: "function unavailable" },
      }));
      serverMock.createClient.mockResolvedValue(clientWithOtp(rpc));

      const response = await GET(callback("?token_hash=abc&type=invite"));

      expect(errors).toHaveBeenCalled();
      expect(locationOf(response)).toBe(
        "https://platform.example.com/workspaces",
      );
      errors.mockRestore();
    });
  });

  it("surfaces an error handed back by the provider", async () => {
    const response = await GET(callback("?error_description=Access%20denied"));

    expect(locationOf(response)).toContain("/login");
    expect(queryOf(response).get("error")).toBe("Access denied");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("rejects a callback with no code", async () => {
    const response = await GET(callback(""));

    expect(queryOf(response).get("error")).toBe("missing_code");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("reports a failed code exchange", async () => {
    serverMock.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {},
          error: { message: "code verifier mismatch" },
        })),
      },
    });

    const response = await GET(callback("?code=abc"));

    expect(queryOf(response).get("error")).toBe("code verifier mismatch");
  });

  it("exchanges the code for a session", async () => {
    const exchange = vi.fn(async () => ({ data: {}, error: null }));
    serverMock.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: exchange },
      rpc: vi.fn(async () => ({ data: 0, error: null })),
    });

    await GET(callback("?code=abc&next=%2Facme%2Fdashboard"));

    expect(exchange).toHaveBeenCalledWith("abc");
  });

  it("returns the user to the path they started from", async () => {
    const response = await GET(callback("?code=abc&next=%2Facme%2Fdashboard"));

    expect(locationOf(response)).toBe(
      "https://platform.example.com/acme/dashboard",
    );
  });

  it("defaults to the workspace picker", async () => {
    const response = await GET(callback("?code=abc"));

    expect(locationOf(response)).toBe("https://platform.example.com/workspaces");
  });

  describe("open-redirect protection", () => {
    it.each([
      ["%2F%2Fevil.example.com", "protocol-relative"],
      ["https%3A%2F%2Fevil.example.com", "absolute https"],
      ["http%3A%2F%2Fevil.example.com", "absolute http"],
      ["javascript%3Aalert(1)", "javascript scheme"],
      ["https:%2F%2Fevil.example.com", "slash-in-scheme"],
      ["%2F%5Cevil.example.com", "backslash after a slash"],
      ["%2Facme%5C..%2F..%2Fevil", "backslash in the path"],
    ])("ignores next=%s (%s)", async (next) => {
      const response = await GET(callback(`?code=abc&next=${next}`));

      expect(locationOf(response)).toBe(
        "https://platform.example.com/workspaces",
      );
    });

    it("still honours a legitimate multi-segment tenant path", async () => {
      const response = await GET(
        callback("?code=abc&next=%2Facme%2Fsettings%2Fbilling"),
      );

      expect(locationOf(response)).toBe(
        "https://platform.example.com/acme/settings/billing",
      );
    });
  });

  describe("session cookie size", () => {
    /** A client whose OAuth exchange hands back provider tokens, like Google. */
    function withSession(session: unknown) {
      const setSession = vi.fn(
        async (): Promise<{
          data: unknown;
          error: { message: string } | null;
        }> => ({ data: {}, error: null }),
      );
      serverMock.createClient.mockResolvedValue({
        auth: {
          exchangeCodeForSession: vi.fn(async () => ({
            data: { session },
            error: null,
          })),
          verifyOtp: vi.fn(async () => ({ data: { session }, error: null })),
          setSession,
        },
        rpc: vi.fn(async () => ({ data: 0, error: null })),
      });
      return setSession;
    }

    const googleSession = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      provider_token: "google-access-token",
      provider_refresh_token: "google-refresh-token",
    };

    it("re-stores an OAuth session without the provider tokens", async () => {
      // They are 2.4 KB of a 5.7 KB session, and `@supabase/ssr` chunks the
      // session into 3 KB cookies — keeping them costs a third cookie on every
      // request from then on.
      const setSession = withSession(googleSession);

      const response = await GET(callback("?code=abc&next=%2Facme"));

      expect(setSession).toHaveBeenCalledWith({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });
      expect(locationOf(response)).toBe("https://platform.example.com/acme");
    });

    it("leaves an email session alone", async () => {
      // No provider tokens to drop, so the extra round trip is not paid.
      const setSession = withSession({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });

      await GET(callback("?token_hash=h1&type=magiclink"));

      expect(setSession).not.toHaveBeenCalled();
    });

    it("still completes the sign-in when re-storing fails", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const setSession = withSession(googleSession);
      setSession.mockResolvedValueOnce({
        data: {},
        error: { message: "network down" },
      });

      const response = await GET(callback("?code=abc"));

      expect(errors).toHaveBeenCalled();
      expect(locationOf(response)).toBe("https://platform.example.com/workspaces");
      errors.mockRestore();
    });

    it("still completes the sign-in when the client throws", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const setSession = withSession(googleSession);
      setSession.mockRejectedValueOnce(new Error("boom"));

      const response = await GET(callback("?code=abc"));

      expect(errors).toHaveBeenCalled();
      expect(locationOf(response)).toBe("https://platform.example.com/workspaces");
      errors.mockRestore();
    });
  });

  describe("email links", () => {
    /** A client whose two verification paths are both observable. */
    function withAuth() {
      const verifyOtp = vi.fn(async () => ({ data: {}, error: null }));
      const exchangeCodeForSession = vi.fn(async () => ({
        data: {},
        error: null,
      }));
      serverMock.createClient.mockResolvedValue({
        auth: { verifyOtp, exchangeCodeForSession },
        rpc: vi.fn(async () => ({ data: 0, error: null })),
      });
      return { verifyOtp, exchangeCodeForSession };
    }

    it("verifies a token hash instead of exchanging a code", async () => {
      const { verifyOtp, exchangeCodeForSession } = withAuth();

      const response = await GET(
        callback("?token_hash=h1&type=magiclink&next=%2Facme%2Fdashboard"),
      );

      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: "h1",
        type: "magiclink",
      });
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
      expect(locationOf(response)).toBe(
        "https://platform.example.com/acme/dashboard",
      );
    });

    it("verifies a sign-up confirmation", async () => {
      const { verifyOtp } = withAuth();

      await GET(callback("?token_hash=h2&type=signup"));

      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: "h2",
        type: "signup",
      });
    });

    it.each([
      ["banana", "unknown"],
      ["", "missing"],
    ])("falls back to `email` for a %s type (%s)", async (type) => {
      const { verifyOtp } = withAuth();

      await GET(callback(`?token_hash=h3&type=${type}`));

      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: "h3",
        type: "email",
      });
    });

    it("prefers the token hash when a code comes along too", async () => {
      // A bare code is useless without the PKCE cookie, the token hash is not.
      const { verifyOtp, exchangeCodeForSession } = withAuth();

      await GET(callback("?code=abc&token_hash=h4&type=signup"));

      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: "h4",
        type: "signup",
      });
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it("reports a failed verification", async () => {
      serverMock.createClient.mockResolvedValue({
        auth: {
          verifyOtp: vi.fn(async () => ({
            data: {},
            error: { message: "Email link is invalid or has expired" },
          })),
        },
      });

      const response = await GET(callback("?token_hash=h5"));

      expect(queryOf(response).get("error")).toBe(
        "Email link is invalid or has expired",
      );
    });
  });
});
