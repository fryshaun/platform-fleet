import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: sessionMock.updateSession,
}));

const { default: proxy, config } = await import("@/proxy");

function request(path: string) {
  return new NextRequest(new URL(path, "https://platform.example.com"));
}

/**
 * A stand-in for `updateSession`'s return value. `everyone` decides whether the
 * caller appears signed in; `sessionResponse` carries any rotated cookies.
 */
function session(
  userId: string | null,
  sessionResponse: NextResponse = NextResponse.next(),
) {
  sessionMock.updateSession.mockResolvedValue({
    response: sessionResponse,
    userId,
  });
}

function redirectTarget(response: NextResponse): URL {
  return new URL(response.headers.get("location") ?? "");
}

/** `NextResponse.next()` marks a pass-through with this header. */
function isPassThrough(response: NextResponse): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy", () => {
  beforeEach(() => {
    sessionMock.updateSession.mockReset();
  });

  describe("anonymous requests", () => {
    beforeEach(() => session(null));

    it("bounces a tenant route to the login page", async () => {
      const response = await proxy(request("/acme/dashboard"));

      expect(response.status).toBe(307);
      const url = redirectTarget(response);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("next")).toBe("/acme/dashboard");
    });

    it("remembers the query string it was asked for", async () => {
      const response = await proxy(request("/acme/dashboard?tab=activity"));

      expect(redirectTarget(response).searchParams.get("next")).toBe(
        "/acme/dashboard?tab=activity",
      );
    });

    it("bounces the onboarding flow", async () => {
      const response = await proxy(request("/onboarding"));

      expect(redirectTarget(response).pathname).toBe("/login");
    });

    it("bounces the workspace picker", async () => {
      const response = await proxy(request("/workspaces"));

      expect(redirectTarget(response).pathname).toBe("/login");
    });

    it("lets the marketing page through", async () => {
      expect(isPassThrough(await proxy(request("/")))).toBe(true);
    });

    it("forwards a result that landed on the marketing page", async () => {
      // When a redirect target is missing from Supabase's allow-list, GoTrue
      // falls back to the project's Site URL — usually the bare origin — and
      // the code arrives at "/", where nothing would consume it.
      const response = await proxy(request("/?code=abc"));

      expect(response.status).toBe(307);
      const url = redirectTarget(response);
      expect(url.pathname).toBe("/auth/callback");
      expect(url.searchParams.get("code")).toBe("abc");
    });

    it("forwards the rest of the query untouched", async () => {
      const response = await proxy(
        request("/?code=abc&type=magiclink&next=%2Facme%2Fdashboard"),
      );

      const url = redirectTarget(response);
      expect(url.pathname).toBe("/auth/callback");
      expect(url.searchParams.get("type")).toBe("magiclink");
      expect(url.searchParams.get("next")).toBe("/acme/dashboard");
    });

    it("forwards a provider error the same way", async () => {
      const response = await proxy(request("/?error_description=Access%20denied"));

      const url = redirectTarget(response);
      expect(url.pathname).toBe("/auth/callback");
      expect(url.searchParams.get("error_description")).toBe("Access denied");
    });

    it("carries rotated cookies onto the forward", async () => {
      const sessionResponse = NextResponse.next();
      sessionResponse.cookies.set("sb-refresh-token", "rotated");
      session(null, sessionResponse);

      const response = await proxy(request("/?code=abc"));

      expect(response.cookies.get("sb-refresh-token")?.value).toBe("rotated");
    });

    it("lets the auth entry points through", async () => {
      // Redirecting these would loop.
      expect(isPassThrough(await proxy(request("/login")))).toBe(true);
      expect(isPassThrough(await proxy(request("/signup")))).toBe(true);
    });

    it("lets reserved top-level routes through", async () => {
      for (const path of ["/api/stripe/webhook", "/auth/callback"]) {
        expect(isPassThrough(await proxy(request(path))), path).toBe(true);
      }
    });

    it("lets the reset page through, so it can explain an expired link", async () => {
      // A recovery link works in a browser that has never signed in, and the
      // page itself decides whether the cookie proves anything.
      expect(isPassThrough(await proxy(request("/reset-password")))).toBe(true);
    });

    it("bounces the two-factor screens, which need a session to raise", async () => {
      // `/mfa` is where an aal1 session is sent; an anonymous visitor has no
      // factor to prove and is sent to sign in first.
      for (const path of ["/mfa", "/mfa/setup"]) {
        const response = await proxy(request(path));

        expect(response.headers.get("location"), path).toContain("/login");
      }
    });

    it("carries rotated auth cookies onto the redirect", async () => {
      // Dropping them here would silently end the session.
      const sessionResponse = NextResponse.next();
      sessionResponse.cookies.set("sb-refresh-token", "rotated");
      session(null, sessionResponse);

      const response = await proxy(request("/acme/dashboard"));

      expect(response.cookies.get("sb-refresh-token")?.value).toBe("rotated");
    });
  });

  describe("signed-in requests", () => {
    beforeEach(() => session("user-1"));

    it("lets a tenant route through", async () => {
      expect(isPassThrough(await proxy(request("/acme/dashboard")))).toBe(true);
    });

    it("lets onboarding and the workspace picker through", async () => {
      expect(isPassThrough(await proxy(request("/onboarding")))).toBe(true);
      expect(isPassThrough(await proxy(request("/workspaces")))).toBe(true);
    });

    it("sends a signed-in user away from the auth screens", async () => {
      for (const path of ["/login", "/signup"]) {
        const response = await proxy(request(path));
        expect(redirectTarget(response).pathname, path).toBe("/workspaces");
      }
    });

    it("leaves the reset page reachable, because recovery signs you in", async () => {
      // The callback verifies the link and starts a session *before* sending
      // the browser here, so bouncing it like `/login` would break the flow.
      expect(isPassThrough(await proxy(request("/reset-password")))).toBe(true);
    });

    it("still reconciles auth cookies on the redirect", async () => {
      const sessionResponse = NextResponse.next();
      sessionResponse.cookies.set("sb-refresh-token", "rotated");
      session("user-1", sessionResponse);

      const response = await proxy(request("/login"));

      expect(response.cookies.get("sb-refresh-token")?.value).toBe("rotated");
    });
  });

  it("hands every request to updateSession, including unknown paths", async () => {
    session(null);
    await proxy(request("/nope/whatever"));

    expect(sessionMock.updateSession).toHaveBeenCalledTimes(1);
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("runs on application routes", () => {
    for (const path of ["/", "/acme/dashboard", "/api/stripe/webhook"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });

  it("skips Next internals and static assets", () => {
    for (const path of [
      "/_next/static/chunk.js",
      "/_next/image",
      "/favicon.ico",
      "/logo.png",
      "/styles.css",
      "/font.woff2",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});
