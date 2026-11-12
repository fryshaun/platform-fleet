import { describe, expect, it } from "vitest";

import {
  componentWhereLabel,
  componentsForAsset,
  deriveKindHandle,
  fittedWindowProblem,
  isFitted,
  kindHandleProblem,
  kindNameProblem,
  parseComponentDraft,
  parseComponentKindDraft,
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
      draft: { name: "Wheelset", handle: "wheelset", position: 0 },
    });
    expect(
      parseComponentKindDraft(formDataOf({ name: "Fork", position: "3" })),
    ).toEqual({ draft: { name: "Fork", handle: "fork", position: 3 } });
  });

  it("keeps the address an edit did not touch", () => {
    expect(
      parseComponentKindDraft(
        formDataOf({ name: "Forks", current_handle: "fork" }),
      ),
    ).toEqual({ draft: { name: "Forks", handle: "fork", position: 0 } });
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
