import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

/**
 * `next` is echoed into a redirect after sign-in, so these are the cases that
 * would otherwise send a freshly authenticated user to somebody else's site.
 */
describe("safeNextPath", () => {
  it.each([
    "/workspaces",
    "/acme/dashboard",
    "/acme/settings/billing",
    "/acme/dashboard?tab=activity",
    // Contains `//` but only inside the query, so the path is still ours.
    "/login?next=//evil.example.com",
  ])("keeps the same-origin path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["//evil.example.com", "protocol-relative"],
    ["/\\evil.example.com", "backslash after a slash"],
    ["/acme\\..\\..\\evil", "backslash in the path"],
    ["https://evil.example.com", "absolute https"],
    ["http://evil.example.com", "absolute http"],
    ["javascript:alert(1)", "javascript scheme"],
    ["workspaces", "no leading slash"],
    ["", "empty"],
    ["/acme\u0000", "null byte"],
    ["/acme\nSet-Cookie: x", "newline"],
  ])("refuses %s (%s)", (value) => {
    expect(safeNextPath(value)).toBe("/workspaces");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeNextPath("//evil.example.com", "/onboarding")).toBe(
      "/onboarding",
    );
  });

  it("treats a non-string as absent", () => {
    expect(safeNextPath(null)).toBe("/workspaces");
    expect(safeNextPath(undefined)).toBe("/workspaces");
  });

  it("trims padding instead of passing it on", () => {
    expect(safeNextPath("  /acme/dashboard  ")).toBe("/acme/dashboard");
  });
});
