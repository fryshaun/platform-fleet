import { describe, expect, it } from "vitest";

import {
  ASSET_SETTABLE_STATUSES,
  ASSET_SORT_OPTIONS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_OPTIONS,
  ASSET_STATUSES,
  assetHandleProblem,
  assetNameProblem,
  assetsByProduct,
  assetsForProduct,
  assetStatusLabel,
  availabilityLabel,
  deriveAssetHandle,
  formatStatusChanged,
  isAssetAvailable,
  isAssetStatus,
  isSettableAssetStatus,
  readAssetSort,
  serialProblem,
  summariseAssets,
} from "@/lib/assets";

import { PRODUCT_ID, assetRow } from "../helpers/fixtures";

describe("asset statuses", () => {
  it("offers a label and an explanation for every status a person may set", () => {
    // `rented` is a status but not a choice: the form has no row for it.
    expect(ASSET_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...ASSET_SETTABLE_STATUSES,
    ]);

    for (const option of ASSET_STATUS_OPTIONS) {
      expect(option.label).toBe(ASSET_STATUS_LABELS[option.value]);
      expect(option.description.length).toBeGreaterThan(0);
    }

    expect(ASSET_STATUSES).toEqual([
      "available",
      "in_workshop",
      "retired",
      "rented",
    ]);
  });

  it("recognises only the four statuses", () => {
    for (const status of ASSET_STATUSES) {
      expect(isAssetStatus(status)).toBe(true);
    }

    for (const value of ["sold", "maintenance", "Available", "", null, 3]) {
      expect(isAssetStatus(value)).toBe(false);
    }
  });

  it("labels a status the way the pill spells it", () => {
    expect(assetStatusLabel("in_workshop")).toBe("In the workshop");
    expect(assetStatusLabel("rented")).toBe("Out on hire");
  });

  it("does not let a person type \"rented\"", () => {
    // The status belongs to the booking. The form offers three, the action
    // refuses the fourth, and this is the pair that keeps them in step.
    expect(ASSET_SETTABLE_STATUSES).toEqual([
      "available",
      "in_workshop",
      "retired",
    ]);
    expect(isSettableAssetStatus("available")).toBe(true);
    expect(isSettableAssetStatus("rented")).toBe(false);
    expect(ASSET_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...ASSET_SETTABLE_STATUSES,
    ]);
  });
});

describe("readAssetSort", () => {
  it("keeps a known order", () => {
    for (const option of ASSET_SORT_OPTIONS) {
      expect(readAssetSort(option.value)).toBe(option.value);
    }
  });

  it("falls back to name for anything else", () => {
    for (const value of ["", "size", "NAME", null, undefined, 2]) {
      expect(readAssetSort(value)).toBe("name");
    }
  });

  it("starts with name, so the default needs no query", () => {
    expect(ASSET_SORT_OPTIONS[0].value).toBe("name");
  });
});

describe("assetHandleProblem", () => {
  it("asks for an address when the field is empty", () => {
    expect(assetHandleProblem("")).toBe("Enter an asset address.");
  });

  it("refuses the section's own route names", () => {
    expect(assetHandleProblem("new")).toContain("reserved");
    // `/assets/kinds` is the taxonomy page; a unit handled "kinds" would hide it.
    expect(assetHandleProblem("kinds")).toContain("reserved");
  });

  it("applies the company slug rules", () => {
    expect(assetHandleProblem("ab")).toBe("Use at least 3 characters.");
    expect(assetHandleProblem("Bike-1")).toContain("lowercase letters");
  });

  it("accepts a usable handle", () => {
    expect(assetHandleProblem("bike-1")).toBeNull();
    expect(assetHandleProblem("boat-007")).toBeNull();
  });
});

describe("deriveAssetHandle", () => {
  it("joins the parts into one slug", () => {
    expect(deriveAssetHandle("Bike", "1")).toBe("bike-1");
  });

  it("folds accents and drops the empties", () => {
    expect(deriveAssetHandle("", "Málaga Bike 2", "")).toBe("malaga-bike-2");
  });

  it("returns an empty string when there is nothing to slug", () => {
    expect(deriveAssetHandle()).toBe("");
  });
});

describe("field limits", () => {
  it("requires a name", () => {
    expect(assetNameProblem("")).toContain("bike-1");
    expect(assetNameProblem("   ")).toContain("bike-1");
  });

  it("mirrors the 80-character limit on the name", () => {
    expect(assetNameProblem("b".repeat(80))).toBeNull();
    expect(assetNameProblem("b".repeat(81))).toContain("80");
  });

  it("mirrors the 120-character limit on the serial", () => {
    expect(serialProblem("")).toBeNull();
    expect(serialProblem("S".repeat(120))).toBeNull();
    expect(serialProblem("S".repeat(121))).toContain("120");
  });
});

describe("availability", () => {
  it("counts only available units as bookable", () => {
    expect(isAssetAvailable({ status: "available" })).toBe(true);
    expect(isAssetAvailable({ status: "in_workshop" })).toBe(false);
    expect(isAssetAvailable({ status: "retired" })).toBe(false);
    // Out on hire is unavailable without being out of service.
    expect(isAssetAvailable({ status: "rented" })).toBe(false);
  });

  it("counts a fleet by status", () => {
    const assets = [
      assetRow(),
      assetRow({ id: "a2", status: "available" }),
      assetRow({ id: "a3", status: "in_workshop" }),
      assetRow({ id: "a4", status: "retired" }),
      assetRow({ id: "a5", status: "rented" }),
    ];

    expect(summariseAssets(assets)).toEqual({
      total: 5,
      available: 2,
      outOfService: 1,
      outOnHire: 1,
      retired: 1,
    });
  });

  it("answers zeroes for an empty fleet", () => {
    expect(summariseAssets([])).toEqual({
      total: 0,
      available: 0,
      outOfService: 0,
      outOnHire: 0,
      retired: 0,
    });
  });

  it("says so when there is nothing to count", () => {
    expect(availabilityLabel([])).toBe("No units yet");
  });

  it("says when everything is available", () => {
    expect(availabilityLabel([assetRow(), assetRow({ id: "a2" })])).toBe(
      "All 2 available",
    );
  });

  it("names the fraction that can be booked", () => {
    // The sentence the shop needs: two of three units, whatever the reason for
    // the third.
    expect(
      availabilityLabel([
        assetRow(),
        assetRow({ id: "a2" }),
        assetRow({ id: "a3", status: "in_workshop" }),
      ]),
    ).toBe("2 of 3 available");
  });

  it("says none when every unit is out of service", () => {
    expect(
      availabilityLabel([
        assetRow({ status: "in_workshop" }),
        assetRow({ id: "a2", status: "retired" }),
      ]),
    ).toBe("None of 2 available");
  });
});

describe("assetsForProduct", () => {
  const assets = [
    assetRow({ id: "a1", product_id: PRODUCT_ID }),
    assetRow({ id: "a2", product_id: null }),
    assetRow({ id: "a3", product_id: PRODUCT_ID }),
  ];

  it("keeps the units assigned to one product", () => {
    expect(assetsForProduct(assets, PRODUCT_ID).map((asset) => asset.id)).toEqual([
      "a1",
      "a3",
    ]);
  });

  it("answers nothing for a product with no units", () => {
    expect(assetsForProduct(assets, "unknown")).toEqual([]);
  });

  it("groups the fleet by product, unassigned units last", () => {
    const groups = assetsByProduct(assets);

    expect(groups.get(PRODUCT_ID)?.map((asset) => asset.id)).toEqual([
      "a1",
      "a3",
    ]);
    // An unassigned unit is a real state, so it gets a group of its own rather
    // than being dropped.
    expect(groups.get("")?.map((asset) => asset.id)).toEqual(["a2"]);
  });
});

describe("formatStatusChanged", () => {
  it("reads the timestamp in UTC so the server's zone cannot move it", () => {
    expect(formatStatusChanged("2026-03-04T09:31:00.000Z")).toBe(
      "Mar 4, 2026, 9:31 AM",
    );
  });
});

