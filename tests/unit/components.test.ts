import { describe, expect, it } from "vitest";

import {
  componentWhereLabel,
  componentsForAsset,
  deriveKindHandle,
  describeInterval,
  fittedWindowProblem,
  intervalInputValue,
  isFitted,
  kindHandleProblem,
  kindNameProblem,
  parseComponentDraft,
  parseComponentKindDraft,
  parseIntervalValue,
} from "@/lib/components";

import {
  ASSET_ID,
  COMPONENT_ID,
  COMPONENT_KIND_ID,
  componentRow,
  formDataOf,
} from "../helpers/fixtures";

describe("where a component is", () => {
  it("treats a null removal date as fitted", () => {
    expect(isFitted(componentRow())).toBe(true);
    expect(isFitted(componentRow({ removed_on: "2026-03-01" }))).toBe(false);
    // A part in the bin has no unit, so it is not fitted anywhere.
    expect(isFitted(componentRow({ asset_id: null }))).toBe(false);
  });

  it("says it in words", () => {
    expect(componentWhereLabel(componentRow(), "bike-1")).toBe(
      "Fitted to bike-1",
    );
    expect(
      componentWhereLabel(componentRow({ asset_id: null }), undefined),
    ).toBe("In the parts bin");
    expect(
      componentWhereLabel(componentRow({ removed_on: "2026-03-01" }), "bike-1"),
    ).toBe("Removed");
  });

  it("lists a unit's components with the fitted ones first", () => {
    const fitted = componentRow();
    const older = componentRow({
      id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      fitted_on: "2025-06-01",
      removed_on: "2026-01-01",
    });
    const elsewhere = componentRow({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      asset_id: "dddddddd-1111-4111-8111-dddddddddddd",
    });

    const listed = componentsForAsset([older, elsewhere, fitted], ASSET_ID);

    expect(listed.map((component) => component.id)).toEqual([
      COMPONENT_ID,
      older.id,
    ]);
  });
});

describe("the component form", () => {
  it("reads a fitted part", () => {
    expect(
      parseComponentDraft(
        formDataOf({
          name: "Fox 36",
          serial: "FOX-36-001",
          kind_id: COMPONENT_KIND_ID,
          asset_id: ASSET_ID,
          fitted_on: "2026-01-02",
          notes: "Serviced at fitting",
        }),
      ),
    ).toEqual({
      draft: {
        name: "Fox 36",
        serial: "FOX-36-001",
        kind_id: COMPONENT_KIND_ID,
        asset_id: ASSET_ID,
        fitted_on: "2026-01-02",
        removed_on: null,
        notes: "Serviced at fitting",
      },
    });
  });

  it("reads a part in the bin", () => {
    expect(
      parseComponentDraft(
        formDataOf({ name: "Spare wheel", fitted_on: "2026-01-02" }),
      ),
    ).toEqual({
      draft: {
        name: "Spare wheel",
        serial: null,
        kind_id: null,
        asset_id: null,
        fitted_on: "2026-01-02",
        removed_on: null,
        notes: null,
      },
    });
  });

  it("refuses a name or a serial it cannot store", () => {
    expect(
      parseComponentDraft(formDataOf({ name: "", fitted_on: "2026-01-02" })),
    ).toEqual({ error: "Give the component a name, for example Fox 36." });
    expect(
      parseComponentDraft(
        formDataOf({
          name: "Fox 36",
          serial: "x".repeat(121),
          fitted_on: "2026-01-02",
        }),
      ),
    ).toEqual({ error: "Keep the serial number under 120 characters." });
  });

  it("refuses a window it would have to reject later", () => {
    expect(
      parseComponentDraft(
        formDataOf({
          name: "Fox 36",
          fitted_on: "2026-01-02",
          removed_on: "2026-01-02",
        }),
      ),
    ).toEqual({
      error: "A part cannot come off on or before the day it was fitted.",
    });
  });
});

describe("component kinds", () => {
  it("mirrors the name bounds of the column", () => {
    expect(kindNameProblem("")).toContain("Give the kind a name");
    expect(kindNameProblem("x".repeat(81))).toContain("under 80");
    expect(kindNameProblem("Rear shock")).toBeNull();
  });

  it("refuses a reserved or malformed handle", () => {
    expect(kindHandleProblem("new")).toContain("reserved");
    expect(kindHandleProblem("")).toContain("Enter an address");
    expect(kindHandleProblem("Rear Shock")).not.toBeNull();
    expect(kindHandleProblem("rear-shock")).toBeNull();
  });

  it("derives a handle from the name", () => {
    expect(deriveKindHandle("Rear shock")).toBe("rear-shock");
  });

  it("reads a kind off the form, ordering last", () => {
    expect(parseComponentKindDraft(formDataOf({ name: "Wheelset" }))).toEqual({
      draft: {
        name: "Wheelset",
        handle: "wheelset",
        position: 0,
        interval_days: null,
        interval_km: null,
        interval_hours: null,
      },
    });
    expect(
      parseComponentKindDraft(formDataOf({ name: "Fork", position: "3" })),
    ).toEqual({
      draft: {
        name: "Fork",
        handle: "fork",
        position: 3,
        interval_days: null,
        interval_km: null,
        interval_hours: null,
      },
    });
  });

  it("keeps the address an edit did not touch", () => {
    expect(
      parseComponentKindDraft(
        formDataOf({ name: "Forks", current_handle: "fork" }),
      ),
    ).toEqual({
      draft: {
        name: "Forks",
        handle: "fork",
        position: 0,
        interval_days: null,
        interval_km: null,
        interval_hours: null,
      },
    });
  });

  it("reads the three service intervals", () => {
    // A fork is serviced by hours ridden, a chain by distance, brake fluid by
    // the calendar: one kind may carry all three.
    expect(
      parseComponentKindDraft(
        formDataOf({
          name: "Fork",
          interval_days: "365",
          interval_km: "12000",
          interval_hours: "50",
        }),
      ),
    ).toEqual({
      draft: {
        name: "Fork",
        handle: "fork",
        position: 0,
        interval_days: 365,
        interval_km: 12000,
        interval_hours: 50,
      },
    });
  });

  it("refuses an interval the columns cannot hold", () => {
    expect(
      parseComponentKindDraft(formDataOf({ name: "Fork", interval_days: "1.5" })),
    ).toEqual({ error: "Days between services is a whole number." });
    expect(
      parseComponentKindDraft(formDataOf({ name: "Fork", interval_km: "1.234" })),
    ).toEqual({
      error: "Use a number with at most two decimals for the km interval.",
    });
    expect(
      parseComponentKindDraft(
        formDataOf({ name: "Fork", interval_hours: "100001" }),
      ),
    ).toEqual({ error: "Keep the hours interval under 100,000." });
  });

  it("refuses an order that is not a whole number", () => {
    expect(
      parseComponentKindDraft(formDataOf({ name: "Fork", position: "-1" })),
    ).toEqual({ error: "Order is a whole number, 0 or more." });
  });
});

describe("a component's fitted window", () => {
  it("accepts a part that is still fitted", () => {
    expect(fittedWindowProblem("2026-01-02", "")).toBeNull();
  });

  it("accepts a part that came off later", () => {
    expect(fittedWindowProblem("2026-01-02", "2026-02-01")).toBeNull();
  });

  it("refuses a part that came off on the day it went on", () => {
    // Half-open: it was never fitted. The column's CHECK says the same thing.
    expect(fittedWindowProblem("2026-01-02", "2026-01-02")).toContain(
      "cannot come off on or before",
    );
    expect(fittedWindowProblem("2026-01-02", "2026-01-01")).not.toBeNull();
  });

  it("refuses a fitted date it cannot read", () => {
    expect(fittedWindowProblem("", "")).toContain("Choose the day");
    expect(fittedWindowProblem("yesterday", "")).toContain("Choose the day");
  });
});


describe("service intervals", () => {
  it("treats an empty or zero interval as not measured", () => {
    expect(parseIntervalValue("", "days")).toEqual({ value: null });
    expect(parseIntervalValue("  ", "km")).toEqual({ value: null });
    // 0 and null are one state: the view coalesces the column to 0.
    expect(parseIntervalValue("0", "hours")).toEqual({ value: null });
  });

  it("reads whole days and decimal kilometres", () => {
    expect(parseIntervalValue("90", "days")).toEqual({ value: 90 });
    expect(parseIntervalValue("200.5", "km")).toEqual({ value: 200.5 });
    expect(parseIntervalValue("50.25", "hours")).toEqual({ value: 50.25 });
  });

  it("refuses a fraction of a day, or a negative interval", () => {
    expect(parseIntervalValue("1.5", "days")).toEqual({
      error: "Days between services is a whole number.",
    });
    expect(parseIntervalValue("-5", "km")).toEqual({
      error: "Use a number with at most two decimals for the km interval.",
    });
  });

  it("refuses more precision than the column keeps", () => {
    expect(parseIntervalValue("1.234", "km")).toEqual({
      error: "Use a number with at most two decimals for the km interval.",
    });
  });

  it("shows a stored amount back in the input", () => {
    expect(intervalInputValue(null)).toBe("");
    expect(intervalInputValue(90)).toBe("90");
    expect(intervalInputValue(200.5)).toBe("200.5");
  });

  it("says how often a kind is serviced", () => {
    const none = {
      interval_days: null,
      interval_km: null,
      interval_hours: null,
    };
    expect(describeInterval(none)).toBe("No interval set");
    // A zero from an older row reads as absent, the way the view reads it.
    expect(describeInterval({ ...none, interval_days: 0 })).toBe(
      "No interval set",
    );
    expect(describeInterval({ ...none, interval_km: 200 })).toBe("every 200 km");
    expect(
      describeInterval({
        interval_days: 90,
        interval_km: 200,
        interval_hours: 50,
      }),
    ).toBe("every 90 days · every 200 km · every 50 hours");
    expect(describeInterval({ ...none, interval_days: 1 })).toBe("every 1 day");
  });
});
