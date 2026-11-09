import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrigin } from "@/lib/site";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { headers } = await import("next/headers");

/** Installs the request headers `getOrigin` will read. */
function withHeaders(values: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue(
    new Headers(values) as unknown as Awaited<ReturnType<typeof headers>>,
  );
}

describe("getOrigin", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers x-forwarded-host over host", () => {
    withHeaders({
      "x-forwarded-host": "acme.example.com",
      host: "internal:3000",
      "x-forwarded-proto": "https",
    });

    return expect(getOrigin()).resolves.toBe("https://acme.example.com");
  });

  it("falls back to host when there is no proxy header", () => {
    withHeaders({ host: "acme.example.com" });
    return expect(getOrigin()).resolves.toBe("https://acme.example.com");
  });

  it("assumes https for a non-local host without a proto header", () => {
    withHeaders({ host: "acme.example.com" });
    return expect(getOrigin()).resolves.toBe("https://acme.example.com");
  });

  it("assumes http for localhost", () => {
    withHeaders({ host: "localhost:3000" });
    return expect(getOrigin()).resolves.toBe("http://localhost:3000");
  });

  it("assumes http for the loopback address", () => {
    withHeaders({ host: "127.0.0.1:3000" });
    return expect(getOrigin()).resolves.toBe("http://127.0.0.1:3000");
  });

  it("lets x-forwarded-proto win over the localhost heuristic", () => {
    withHeaders({ host: "localhost:3000", "x-forwarded-proto": "https" });
    return expect(getOrigin()).resolves.toBe("https://localhost:3000");
  });

  it("lets x-forwarded-proto force http on a public host", () => {
    withHeaders({ host: "preview.vercel.app", "x-forwarded-proto": "http" });
    return expect(getOrigin()).resolves.toBe("http://preview.vercel.app");
  });

  it("uses the configured site URL when there is no host header", () => {
    withHeaders({});
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://platform.example.com");
    return expect(getOrigin()).resolves.toBe("https://platform.example.com");
  });

  it("strips a trailing slash from the configured site URL", () => {
    withHeaders({});
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://platform.example.com/");
    return expect(getOrigin()).resolves.toBe("https://platform.example.com");
  });

  it("falls back to localhost when nothing is configured", () => {
    withHeaders({});
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    return expect(getOrigin()).resolves.toBe("http://localhost:3000");
  });

  it("never returns a trailing slash, so URLs can be concatenated", async () => {
    withHeaders({ host: "acme.example.com" });
    const origin = await getOrigin();
    expect(origin.endsWith("/")).toBe(false);
    expect(`${origin}/acme/settings/billing`).toBe(
      "https://acme.example.com/acme/settings/billing",
    );
  });

  describe("host header validation", () => {
    function spyOnConsoleError() {
      return vi.spyOn(console, "error").mockImplementation(() => {});
    }

    it.each([
      ["evil.example.com/path", "a path"],
      ["user@evil.example.com", "userinfo"],
      ["acme.example.com,evil.example.com", "two hosts"],
      ["acme example.com", "whitespace"],
      ["acme.example.com:3000:4000", "two ports"],
    ])("refuses a host containing %s (%s)", async (host) => {
      const consoleError = spyOnConsoleError();
      withHeaders({ host });
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://platform.example.com");

      // The header value would otherwise end up in a Stripe return URL or an
      // OAuth redirect, where a different authority means a different site.
      await expect(getOrigin()).resolves.toBe("https://platform.example.com");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("malformed Host header"),
      );
    });

    it("keeps a well-formed host with a port", async () => {
      withHeaders({ host: "acme.example.com:8443" });

      await expect(getOrigin()).resolves.toBe("https://acme.example.com:8443");
    });

    it("refuses a proto header that is not http or https", async () => {
      withHeaders({ host: "acme.example.com", "x-forwarded-proto": "file" });

      await expect(getOrigin()).resolves.toBe("https://acme.example.com");
    });
  });

  describe("on a Vercel deployment", () => {
    /** The localhost guard is noisy by design; keep it out of test output. */
    function spyOnConsoleError() {
      return vi.spyOn(console, "error").mockImplementation(() => {});
    }

    it("refuses a localhost origin in favour of the production domain", async () => {
      const consoleError = spyOnConsoleError();
      withHeaders({ host: "localhost:3000" });
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "platform.example.com");

      await expect(getOrigin()).resolves.toBe("https://platform.example.com");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Refusing local origin"),
      );
    });

    it("refuses a localhost site URL and uses the deployment URL", async () => {
      // The `.env.example` value copied into a production environment.
      spyOnConsoleError();
      withHeaders({});
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
      vi.stubEnv("VERCEL_URL", "platform-abc123.vercel.app");

      await expect(getOrigin()).resolves.toBe(
        "https://platform-abc123.vercel.app",
      );
    });

    it("normalises a deployment URL that already has a scheme", async () => {
      spyOnConsoleError();
      withHeaders({ host: "localhost:3000" });
      vi.stubEnv("VERCEL_URL", "https://platform-abc123.vercel.app/");

      await expect(getOrigin()).resolves.toBe(
        "https://platform-abc123.vercel.app",
      );
    });

    it("leaves a public origin alone", async () => {
      const consoleError = spyOnConsoleError();
      withHeaders({ host: "acme.example.com" });
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "platform.example.com");

      await expect(getOrigin()).resolves.toBe("https://acme.example.com");
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("prefers the production domain over the per-deployment URL", async () => {
      spyOnConsoleError();
      withHeaders({ host: "localhost:3000" });
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "platform.example.com");
      vi.stubEnv("VERCEL_URL", "platform-abc123.vercel.app");

      // Preview deployments would otherwise build redirect URLs that point at
      // a hostname that changes on every push.
      await expect(getOrigin()).resolves.toBe("https://platform.example.com");
    });

    it("keeps localhost when no deployment URL is known", async () => {
      // `next start` on a laptop sets no VERCEL_* variables, so a local
      // origin is genuine and must not be rewritten.
      withHeaders({ host: "localhost:3000" });

      await expect(getOrigin()).resolves.toBe("http://localhost:3000");
    });
  });
});

describe("test environment", () => {
  it("runs without the deployment variables this build machine sets", () => {
    // `tests/setup/deployment-env.ts` clears these before each file. Without
    // it every assertion above that expects localhost would fail on Vercel
    // and pass locally, which is exactly how this suite first broke CI.
    expect(process.env.VERCEL_URL).toBeUndefined();
    expect(process.env.VERCEL_PROJECT_PRODUCTION_URL).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_SITE_URL).toBeUndefined();
  });
});
