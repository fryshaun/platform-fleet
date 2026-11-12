import { describe, expect, it } from "vitest";

import {
  formatDistance,
  formatHours,
  formatLoggedOn,
  parseUsageDraft,
  summariseUsage,
  usageForAsset,
  usageSummary,
} from "@/lib/usage";

import { ASSET_ID, formDataOf, usageLogRow } from "../helpers/fixtures";

describe("the usage form", () => {
  it("reads hours and kilometres", () => {
    expect(
      parseUsageDraft(
        formDataOf({
          logged_on: "2026-03-04",
          hours: "4.25",
          distance_km: "38",
          notes: "Chain waxed",
        }),
      ),
    ).toEqual({
      draft: {
        logged_on: "2026-03-04",
        hours: 4.25,
        distance_km: 38,
        notes: "Chain waxed",
      },
    });
  });

  it("treats an empty amount as zero", () => {
    // An hour of coaching covers no distance, and a repair ride logs no hours.
    expect(
      parseUsageDraft(
        formDataOf({ logged_on: "2026-03-04", hours: "4" }),
      ),
    ).toEqual({
      draft: {
        logged_on: "2026-03-04",
        hours: 4,
        distance_km: 0,
        notes: null,
      },
    });
  });

  it("refuses a reading that says nothing", () => {
    // The column's CHECK sums up the same way: `hours > 0 or distance_km > 0`.
    expect(parseUsageDraft(formDataOf({ logged_on: "2026-03-04" }))).toEqual({
      error: "A reading needs hours, kilometres, or both.",
    });
  });

  it("refuses a day it cannot read", () => {
    expect(parseUsageDraft(formDataOf({ hours: "4" }))).toEqual({
      error: "Choose the day the use happened.",
    });
  });

  it("refuses amounts the columns cannot hold", () => {
    expect(
      parseUsageDraft(
        formDataOf({ logged_on: "2026-03-04", hours: "1.234" }),
      ),
    ).toEqual({ error: "Hours is a number, to two decimals at most." });
    expect(
      parseUsageDraft(
        formDataOf({ logged_on: "2026-03-04", distance_km: "100001" }),
      ),
    ).toEqual({
      error:
        "That is more kilometres than one entry should hold — check the reading.",
    });
  });
});

describe("a unit's readings", () => {
  it("lists this unit's readings, newest first", () => {
    const mine = usageLogRow();
    const older = usageLogRow({ id: "b2", logged_on: "2026-01-04" });
    const elsewhere = usageLogRow({
      id: "b3",
      asset_id: "dddddddd-1111-4111-8111-dddddddddddd",
    });

    expect(
      usageForAsset([older, elsewhere, mine], ASSET_ID).map((log) => log.id),
    ).toEqual([mine.id, older.id]);
  });

  it("adds up to the only total there is", () => {
    const logs = [
      usageLogRow({ id: "b1", hours: 4.25, distance_km: 38 }),
      usageLogRow({ id: "b2", hours: 0.1, distance_km: 0.2 }),
      // 0.1 + 0.2 is not 0.3 in binary floating point; the sum must not say so.
      usageLogRow({ id: "b3", hours: 0.2, distance_km: 0 }),
    ];

    expect(summariseUsage(logs)).toEqual({
      readings: 3,
      hours: 4.55,
      distanceKm: 38.2,
    });
  });

  it("says it in words", () => {
    expect(usageSummary([])).toBe("No readings yet.");
    expect(
      usageSummary([usageLogRow({ hours: 1, distance_km: 0 })]),
    ).toBe("1 reading · 1 hour");
    expect(
      usageSummary([
        usageLogRow({ id: "b1", hours: 4.25, distance_km: 38 }),
        usageLogRow({ id: "b2", hours: 0, distance_km: 2 }),
      ]),
    ).toBe("2 readings · 4.25 hours · 40 km");
  });

  it("formats the amounts without trailing zeros", () => {
    expect(formatHours(12.5)).toBe("12.5 hours");
    expect(formatHours(1)).toBe("1 hour");
    expect(formatDistance(38)).toBe("38 km");
    expect(formatDistance(38.25)).toBe("38.25 km");
    // `date` columns carry no zone; reading them in UTC keeps the day typed.
    expect(formatLoggedOn("2026-03-04")).toBe("Mar 4, 2026");
  });
});
