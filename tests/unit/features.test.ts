import { describe, expect, it } from "vitest";

import {
  enabledSectionKeys,
  isSectionEnabled,
  isSectionKey,
  parseSectionKeys,
  SECTION_KEYS,
  SECTION_OPTIONS,
  SECTIONS,
} from "@/lib/features";

import { companyRow } from "../helpers/fixtures";

const PATH_PATTERN = /^[a-z][a-z0-9-]*$/;

describe("section registry", () => {
  it("describes every key exactly once", () => {
    expect(Object.keys(SECTIONS).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it("uses the key as the path segment the database checks", () => {
    // `has_company_section(company_id, 'products')` and the route folder have to
    // agree, so the key *is* the path.
    for (const key of SECTION_KEYS) {
      expect(SECTIONS[key].key).toBe(key);
      expect(SECTIONS[key].path).toBe(key);
      expect(key).toMatch(PATH_PATTERN);
    }
  });

  it("gives every section a label and an explanation", () => {
    for (const key of SECTION_KEYS) {
      expect(SECTIONS[key].label.length).toBeGreaterThan(0);
      expect(SECTIONS[key].description.length).toBeGreaterThan(0);
    }
  });

  it("mirrors the registry in the settings checklist", () => {
    expect(SECTION_OPTIONS.map((option) => option.value)).toEqual([
      ...SECTION_KEYS,
    ]);

    for (const option of SECTION_OPTIONS) {
      expect(option.label).toBe(SECTIONS[option.value].label);
      expect(option.description).toBe(SECTIONS[option.value].description);
    }
  });
});

describe("isSectionKey", () => {
  it("accepts a known key", () => {
    expect(isSectionKey("products")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["billing", "Products", "", null, undefined, 7]) {
      expect(isSectionKey(value)).toBe(false);
    }
  });
});

describe("parseSectionKeys", () => {
  it("keeps known keys and drops the rest", () => {
    expect(parseSectionKeys(["products", "services", "", "PRODUCTS"])).toEqual([
      "products",
    ]);
  });

  it("collapses duplicates and returns registry order", () => {
    expect(parseSectionKeys(["products", "products"])).toEqual(["products"]);
  });

  it("answers an empty list for no selection", () => {
    expect(parseSectionKeys([])).toEqual([]);
  });
});

describe("enabledSectionKeys", () => {
  it("returns only keys this build knows", () => {
    // A row can hold a key a previous deployment wrote; it must not be rendered
    // or routed to.
    expect(
      enabledSectionKeys({ enabled_sections: ["products", "unknown"] }),
    ).toEqual(["products"]);
  });

  it("treats a missing value as nothing enabled", () => {
    expect(enabledSectionKeys({ enabled_sections: [] })).toEqual([]);
  });
});

describe("isSectionEnabled", () => {
  it("is true only when the key is in the row", () => {
    expect(isSectionEnabled({ enabled_sections: ["products"] }, "products")).toBe(
      true,
    );
    expect(isSectionEnabled({ enabled_sections: [] }, "products")).toBe(false);
    expect(
      isSectionEnabled({ enabled_sections: ["services"] }, "products"),
    ).toBe(false);
  });

  it("does not consult billing", () => {
    // The switch is a workspace preference in v1: an unpaid workspace that
    // turned the section on still sees it. Tier gating is a separate seam that
    // would have to be added here *and* in `has_company_section()`.
    expect(
      isSectionEnabled(
        companyRow({
          enabled_sections: ["products"],
          subscription_status: "none",
        }),
        "products",
      ),
    ).toBe(true);
  });
});
