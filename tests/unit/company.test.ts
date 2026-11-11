import { describe, expect, it } from "vitest";

import {
  COMPANY_BADGE_MAX,
  COMPANY_LOGOS_BUCKET,
  COMPANY_LOGO_ACCEPT,
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_TYPES,
  companyBadge,
  companyBadgeProblem,
  companyLogoPath,
  companyLogoStoragePath,
  companyLogoTypeFor,
  companyMark,
  isCompanyLogoPath,
} from "@/lib/company";

/** The identity rules the settings form, the actions and the bucket agree on. */

describe("companyBadge", () => {
  it("trims the value a person typed", () => {
    expect(companyBadge("  AB  ")).toBe("AB");
    expect(companyBadge("🚀")).toBe("🚀");
  });

  it("turns nothing into null, which means \"draw the initials\"", () => {
    expect(companyBadge("")).toBeNull();
    expect(companyBadge("   ")).toBeNull();
    expect(companyBadge("\t\n")).toBeNull();
  });
});

describe("companyBadgeProblem", () => {
  it("accepts an empty field, so the badge can be cleared", () => {
    expect(companyBadgeProblem("")).toBeNull();
    expect(companyBadgeProblem("   ")).toBeNull();
  });

  it("accepts one or two characters", () => {
    expect(companyBadgeProblem("A")).toBeNull();
    expect(companyBadgeProblem("AB")).toBeNull();
  });

  it("accepts a single emoji, whatever it is built from", () => {
    // One code point.
    expect(companyBadgeProblem("🚀")).toBeNull();
    // A flag is two regional indicators.
    expect(companyBadgeProblem("🇬🇧")).toBeNull();
    // A family is several code points joined by zero-width joiners.
    expect(companyBadgeProblem("👨‍👩‍👧‍👦")).toBeNull();
  });

  it("counts graphemes, not UTF-16 code units", () => {
    expect(companyBadgeProblem("AB🚀")).toBe(
      `Keep the badge to ${COMPANY_BADGE_MAX} characters.`,
    );
  });

  it("refuses a third character", () => {
    expect(companyBadgeProblem("ABC")).toBe(
      `Keep the badge to ${COMPANY_BADGE_MAX} characters.`,
    );
  });

  it("refuses internal whitespace, which would collapse in the square", () => {
    expect(companyBadgeProblem("A B")).toBe(
      "Use one or two characters, or a single emoji.",
    );
    expect(companyBadgeProblem("A\tB")).toBe(
      "Use one or two characters, or a single emoji.",
    );
  });
});

describe("companyMark", () => {
  it("prefers the badge to the initials", () => {
    expect(companyMark("Acme Studio", "AS")).toBe("AS");
    expect(companyMark("Acme Studio", "🚀")).toBe("🚀");
  });

  it("falls back to the initials when there is no badge", () => {
    expect(companyMark("Acme Studio", null)).toBe("AS");
  });

  it("treats a blank badge as no badge", () => {
    expect(companyMark("Acme Studio", "   ")).toBe("AS");
  });

  it("never renders nothing", () => {
    expect(companyMark("", null)).toBe("?");
  });
});

describe("logo types", () => {
  it("mirrors the bucket's size ceiling", () => {
    expect(COMPANY_LOGO_MAX_BYTES).toBe(2_097_152);
  });

  it("offers the four types the bucket accepts", () => {
    expect(COMPANY_LOGO_TYPES.map((type) => type.mime)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
    ]);
    expect(COMPANY_LOGO_ACCEPT).toBe(
      "image/png,image/jpeg,image/webp,image/avif",
    );
  });

  it("maps a mime type to its extension", () => {
    expect(companyLogoTypeFor("image/png")?.extension).toBe("png");
    expect(companyLogoTypeFor("image/jpeg")?.extension).toBe("jpg");
    expect(companyLogoTypeFor("image/gif")).toBeNull();
    expect(companyLogoTypeFor("")).toBeNull();
  });
});

describe("companyLogoPath", () => {
  it("nests the file under the company id, which is what the policies read", () => {
    expect(companyLogoPath("company-1", "abc.png")).toBe("company-1/abc.png");
  });
});

describe("isCompanyLogoPath", () => {
  it("accepts one file in this company's folder", () => {
    expect(isCompanyLogoPath("company-1/abc.png", "company-1")).toBe(true);
    expect(isCompanyLogoPath("company-1/abc.jpg", "company-1")).toBe(true);
    expect(isCompanyLogoPath("company-1/abc.webp", "company-1")).toBe(true);
    expect(isCompanyLogoPath("company-1/abc.avif", "company-1")).toBe(true);
  });

  it("refuses another company's folder", () => {
    expect(isCompanyLogoPath("company-2/abc.png", "company-1")).toBe(false);
  });

  it("refuses a nested path the storage policy would not see", () => {
    expect(isCompanyLogoPath("company-1/nested/abc.png", "company-1")).toBe(
      false,
    );
  });

  it("refuses traversal and extensionless names", () => {
    expect(isCompanyLogoPath("company-1/../abc.png", "company-1")).toBe(false);
    expect(isCompanyLogoPath("company-1/", "company-1")).toBe(false);
    expect(isCompanyLogoPath("company-1/abc", "company-1")).toBe(false);
    expect(isCompanyLogoPath("company-1/.png", "company-1")).toBe(false);
  });

  it("refuses a type the bucket does not allow", () => {
    expect(isCompanyLogoPath("company-1/abc.svg", "company-1")).toBe(false);
  });
});

describe("companyLogoStoragePath", () => {
  const bucket = "https://example.supabase.co/storage/v1/object/public";

  it("finds the object behind one of our own URLs", () => {
    expect(companyLogoStoragePath(`${bucket}/${COMPANY_LOGOS_BUCKET}/c/a.png`)).toBe(
      "c/a.png",
    );
  });

  it("ignores a URL this app did not write", () => {
    expect(companyLogoStoragePath(null)).toBeNull();
    expect(companyLogoStoragePath("")).toBeNull();
    expect(companyLogoStoragePath("https://gravatar.com/avatar/abc.png")).toBeNull();
    // A different bucket is somebody else's business.
    expect(companyLogoStoragePath(`${bucket}/avatars/c/a.png`)).toBeNull();
  });

  it("ignores a path that climbs out of the bucket", () => {
    expect(companyLogoStoragePath(`${bucket}/${COMPANY_LOGOS_BUCKET}/../a.png`)).toBeNull();
  });
});
