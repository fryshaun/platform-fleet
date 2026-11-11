/**
 * Top-level path segments that can never be a tenant slug.
 *
 * Shared by `proxy.ts` (to decide whether the first segment is a tenant) and by
 * onboarding validation (to reject reserved names), so the two cannot drift.
 */
export const RESERVED_SEGMENTS = new Set([
  "api",
  "auth",
  "login",
  "signup",
  "reset-password",
  "onboarding",
  "workspaces",
  "dashboard",
  "settings",
  "admin",
  "www",
  "app",
  "new",
  "help",
  "support",
  "billing",
  "account",
]);

/** Mirrors the `companies.slug` CHECK constraint in the database. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

/** Turns a company name into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

export type SlugProblem = "empty" | "too-short" | "format" | "reserved";

/** Validates a slug and explains what is wrong, if anything. */
export function validateSlug(slug: string): SlugProblem | null {
  if (slug.length === 0) return "empty";
  if (RESERVED_SEGMENTS.has(slug)) return "reserved";
  if (slug.length < 3) return "too-short";
  if (!SLUG_PATTERN.test(slug)) return "format";
  return null;
}

export const SLUG_PROBLEM_MESSAGES: Record<SlugProblem, string> = {
  empty: "Choose a workspace address.",
  "too-short": "Use at least 3 characters.",
  format:
    "Use lowercase letters, numbers and single hyphens, starting and ending with a letter or number.",
  reserved: "That address is reserved. Please pick another.",
};
