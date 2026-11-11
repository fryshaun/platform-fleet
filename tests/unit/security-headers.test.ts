import { describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";

/**
 * Guards the header set in `next.config.ts`.
 *
 * Nothing else exercises it: the app never reads these headers, and a missing
 * one is invisible until it is exploited, so the configuration is pinned here.
 */
async function headersFor(): Promise<Record<string, string>> {
  const rules = await nextConfig.headers?.();
  const rule = rules?.[0];

  expect(rule?.source).toBe("/:path*");

  return Object.fromEntries(
    (rule?.headers ?? []).map((header) => [header.key, header.value]),
  );
}

describe("security headers", () => {
  it("applies to every route", async () => {
    const rules = await nextConfig.headers?.();

    expect(rules).toHaveLength(1);
    expect(rules?.[0].source).toBe("/:path*");
  });

  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ])("sets %s", async (key, value) => {
    expect((await headersFor())[key]).toBe(value);
  });

  it("disables the capabilities the app never uses", async () => {
    const policy = (await headersFor())["Permissions-Policy"];

    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("keeps HSTS out of development, where it would pin localhost to https", async () => {
    // Pinned rather than inherited: the suite runs on build machines too, where
    // the ambient value says nothing about a developer's `next dev`.
    vi.stubEnv("NODE_ENV", "development");

    expect((await headersFor())["Strict-Transport-Security"]).toBeUndefined();
  });

  it("sends HSTS in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const hsts = (await headersFor())["Strict-Transport-Security"];

    expect(hsts).toContain("max-age=63072000");
    // `preload` is omitted: submitting to the preload list is irreversible.
    expect(hsts).not.toContain("preload");
  });
});
