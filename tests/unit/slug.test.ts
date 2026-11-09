import { describe, expect, it } from "vitest";

import {
  RESERVED_SEGMENTS,
  SLUG_PROBLEM_MESSAGES,
  slugify,
  validateSlug,
  type SlugProblem,
} from "@/lib/slug";

/**
 * Verbatim copy of the `companies.slug` CHECK constraint in
 * `supabase/migrations/20260101000000_accounts_and_companies.sql:84`.
 *
 * It is duplicated here on purpose: `tests/db/schema.test.ts` asserts that the
 * migration still contains this exact pattern, so if the database rule changes
 * without the client rule changing, that test fails.
 */
const SLUG_CHECK = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Studio")).toBe("acme-studio");
  });

  it("collapses runs of non-alphanumeric characters into one hyphen", () => {
    expect(slugify("Acme   &   Co!!!")).toBe("acme-co");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("  --Acme--  ")).toBe("acme");
    expect(slugify("!!!acme!!!")).toBe("acme");
  });

  it("strips diacritics rather than dropping the letter", () => {
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
    // `å` decomposes to `a` + combining ring, so it survives as a letter. `ø`
    // has no canonical decomposition, so it degrades to a separator instead.
    expect(slugify("Ångström Øl")).toBe("angstrom-l");
  });

  it("drops characters that have no ASCII decomposition", () => {
    expect(slugify("東京")).toBe("");
    expect(slugify("🎉")).toBe("");
  });

  it("returns an empty string for blank input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("    ")).toBe("");
  });

  it("truncates to 50 characters", () => {
    expect(slugify("a".repeat(60))).toHaveLength(50);
  });

  it("trims a hyphen left behind by truncation", () => {
    // 49 a's, a separator, then `bcd`. Cutting at 50 leaves `…aaa-`, which would
    // violate the `companies.slug` CHECK constraint.
    const slug = slugify(`${"a".repeat(49)} bcd`);
    expect(slug).toBe("a".repeat(49));
    expect(slug.endsWith("-")).toBe(false);
  });

  it("respects multi-byte input when truncating", () => {
    // 60 accented characters become 60 ASCII letters, then get truncated.
    expect(slugify("é".repeat(60))).toBe("e".repeat(50));
  });

  it("never emits uppercase, underscores or double hyphens", () => {
    const slug = slugify("  A__B  C--D  E&&&F  G  ");
    expect(slug).toBe("a-b-c-d-e-f-g");
    expect(slug).not.toMatch(/[A-Z_]/);
    expect(slug).not.toContain("--");
  });

  it("produces a slug the database CHECK constraint accepts, once long enough", () => {
    const inputs = [
      "Acme Studio",
      "  Acme  ",
      "Café Déjà Vu",
      "a",
      "ab",
      "abc",
      "x".repeat(120),
      "Ünïcôdé Ñämé",
      "123 456",
      "A1 B2 C3",
      "!!!",
      "",
    ];

    for (const input of inputs) {
      const slug = slugify(input);

      // `slugify` happily returns a 1- or 2-character slug; rejecting those is
      // `validateSlug`'s job, and the CHECK constraint enforces a 3-char floor.
      if (slug.length < 3) {
        expect(validateSlug(slug), JSON.stringify(input)).not.toBeNull();
        continue;
      }

      expect(
        SLUG_CHECK.test(slug),
        `slugify(${JSON.stringify(input)}) = "${slug}"`,
      ).toBe(true);
    }
  });

  it("is idempotent", () => {
    for (const input of ["Acme Studio", "Café Déjà Vu", "  a  b  ", "東京"]) {
      const once = slugify(input);
      expect(slugify(once)).toBe(once);
    }
  });
});


describe("validateSlug", () => {
  it("accepts a well-formed slug", () => {
    expect(validateSlug("acme")).toBeNull();
    expect(validateSlug("acme-studio")).toBeNull();
    expect(validateSlug("a1-b2-c3")).toBeNull();
  });

  it("accepts double hyphens, which the CHECK constraint permits", () => {
    // `[a-z0-9-]` allows adjacent hyphens, so the database would store this.
    // `slugify` collapses them, so the app can only produce one via no path —
    // but validation must not be stricter than the column it guards.
    expect(validateSlug("acme--studio")).toBeNull();
  });

  it("accepts the exact length boundaries of the constraint", () => {
    expect(validateSlug("abc")).toBeNull();
    expect(validateSlug("a".repeat(50))).toBeNull();
  });

  it("reports an empty slug", () => {
    expect(validateSlug("")).toBe("empty");
  });

  it("reports slugs that are too short", () => {
    expect(validateSlug("a")).toBe("too-short");
    expect(validateSlug("ab")).toBe("too-short");
  });

  it("reports reserved workspace addresses", () => {
    for (const reserved of RESERVED_SEGMENTS) {
      expect(validateSlug(reserved), reserved).toBe("reserved");
    }
  });

  it("reports malformed slugs", () => {
    const malformed = [
      "Acme", // uppercase
      "-acme", // leading hyphen
      "acme-", // trailing hyphen
      "ac me", // space
      "acme_studio", // underscore
      "a".repeat(51), // too long
      "ácme", // non-ASCII
    ];

    for (const slug of malformed) {
      expect(validateSlug(slug), slug).toBe("format");
    }
  });

  it("agrees with the database CHECK constraint on every case", () => {
    const candidates = [
      "",
      "a",
      "ab",
      "abc",
      "acme",
      "Acme",
      "-acme",
      "acme-",
      "acme--studio",
      "acme_studio",
      "ac me",
      "a".repeat(49),
      "a".repeat(50),
      "a".repeat(51),
      "9lives",
    ];

    for (const slug of candidates) {
      // Reserved names are the one intentional divergence: Postgres would store
      // them, but the router needs those path segments for real routes.
      if (RESERVED_SEGMENTS.has(slug)) continue;

      const clientAccepts = validateSlug(slug) === null;
      expect(
        clientAccepts,
        `validateSlug(${JSON.stringify(slug)}) vs CHECK`,
      ).toBe(SLUG_CHECK.test(slug));
    }
  });

  it("only ever reports a problem that has a message", () => {
    const problems: SlugProblem[] = [
      "empty",
      "too-short",
      "format",
      "reserved",
    ];
    for (const problem of problems) {
      expect(SLUG_PROBLEM_MESSAGES[problem]).toBeTruthy();
    }
  });
});

describe("RESERVED_SEGMENTS", () => {
  it("reserves every top-level route the app serves", () => {
    for (const segment of [
      "api",
      "auth",
      "login",
      "signup",
      "onboarding",
      "workspaces",
    ]) {
      expect(RESERVED_SEGMENTS.has(segment), segment).toBe(true);
    }
  });

  it("reserves the names that would shadow a tenant sub-route", () => {
    for (const segment of ["dashboard", "settings", "admin", "billing"]) {
      expect(RESERVED_SEGMENTS.has(segment), segment).toBe(true);
    }
  });

  it("holds lowercase values only, so lookups cannot miss on case", () => {
    for (const segment of RESERVED_SEGMENTS) {
      expect(segment).toBe(segment.toLowerCase());
    }
  });

  it("contains no value the slug pattern would reject", () => {
    for (const segment of RESERVED_SEGMENTS) {
      expect(SLUG_CHECK.test(segment), segment).toBe(true);
    }
  });
});
