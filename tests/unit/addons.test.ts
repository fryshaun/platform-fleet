import { describe, expect, it } from "vitest";

import {
  ADDON_PRICE_KINDS,
  ADDON_PRICE_KIND_LABELS,
  ADDON_PRICE_KIND_OPTIONS,
  ADDON_STATUSES,
  ADDON_STATUS_LABELS,
  MAX_ADDON_QUANTITY,
  MAX_ADDON_STOCK,
  addonChargeCents,
  addonHandleProblem,
  addonNameProblem,
  addonPriceLabel,
  addonQuantityProblem,
  addonScopeByAddon,
  addonStockLabel,
  addonStockProblem,
  addonsForLine,
  bookingAddonsTotal,
  deriveAddonHandle,
  isAddonOfferedFor,
  isAddonPriceKind,
  isAddonStatus,
  lineAddonsTotal,
  parseAddonDraft,
} from "@/lib/addons";

import {
  ADDON_ID,
  PRODUCT_ID,
  addonRow,
  formDataOf,
  lineAddonRow,
} from "../helpers/fixtures";

describe("add-on enumerations", () => {
  it("offers both price kinds, with a label and an explanation each", () => {
    expect(ADDON_PRICE_KIND_OPTIONS.map((option) => option.value)).toEqual([
      ...ADDON_PRICE_KINDS,
    ]);

    for (const option of ADDON_PRICE_KIND_OPTIONS) {
      expect(option.label).toBe(ADDON_PRICE_KIND_LABELS[option.value]);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it("recognises only the two price kinds", () => {
    expect(isAddonPriceKind("per_day")).toBe(true);
    expect(isAddonPriceKind("per_week")).toBe(false);
    expect(isAddonPriceKind(null)).toBe(false);
  });

  it("recognises only the two statuses", () => {
    expect(ADDON_STATUSES).toEqual(["active", "archived"]);
    expect(isAddonStatus("archived")).toBe(true);
    expect(isAddonStatus("deleted")).toBe(false);
    expect(ADDON_STATUS_LABELS.archived).toBe("Archived");
  });
});

describe("add-on handles", () => {
  it("refuses a reserved segment and an empty handle", () => {
    expect(addonHandleProblem("new")).toContain("reserved");
    expect(addonHandleProblem("")).toContain("Enter an address");
  });

  it("accepts a usable slug and refuses a broken one", () => {
    expect(addonHandleProblem("child-seat")).toBeNull();
    expect(addonHandleProblem("Child Seat")).not.toBeNull();
    expect(addonHandleProblem("-helmet")).not.toBeNull();
  });

  it("derives the handle from the name", () => {
    expect(deriveAddonHandle("Child seat")).toBe("child-seat");
  });

  it("mirrors the name bounds of the column", () => {
    expect(addonNameProblem("")).toContain("Give the extra a name");
    expect(addonNameProblem("  ")).not.toBeNull();
    expect(addonNameProblem("x".repeat(121))).toContain("under 120");
    expect(addonNameProblem("Helmet")).toBeNull();
  });
});

describe("how many of an extra a line may take", () => {
  it("refuses a quantity below one", () => {
    expect(addonQuantityProblem(0, 5)).toBe("Choose at least one.");
    expect(addonQuantityProblem(1.5, 5)).toBe("Choose at least one.");
  });

  it("reads the catalogue ceiling", () => {
    expect(addonQuantityProblem(2, 1)).toContain("One of these per line");
    expect(addonQuantityProblem(3, 2)).toBe("At most 2 of these per line.");
    expect(addonQuantityProblem(2, 2)).toBeNull();
  });

  it("never allows more than the column stores", () => {
    expect(addonQuantityProblem(MAX_ADDON_QUANTITY + 1, 500)).toBe(
      `At most ${MAX_ADDON_QUANTITY} of these per line.`,
    );
  });
});

describe("what an extra costs", () => {
  it("charges a per-booking extra once, whatever the window", () => {
    const row = lineAddonRow({ unit_price_cents: 500, quantity: 2 });

    expect(addonChargeCents(row, 1)).toBe(1000);
    expect(addonChargeCents(row, 6)).toBe(1000);
  });

  it("multiplies a per-day extra by the hire's days", () => {
    const row = lineAddonRow({
      unit_price_cents: 500,
      price_kind: "per_day",
      quantity: 2,
    });

    expect(addonChargeCents(row, 4)).toBe(4000);
  });

  it("still charges a day when the window is empty", () => {
    // A same-day collection is a day's hire. A free helmet because the dates
    // were malformed is worse than a charged one.
    const row = lineAddonRow({ price_kind: "per_day", unit_price_cents: 500 });

    expect(addonChargeCents(row, 0)).toBe(500);
  });

  it("adds the extras on a line and on the booking", () => {
    const rows = [
      lineAddonRow({ unit_price_cents: 500, quantity: 1 }),
      lineAddonRow({
        id: "99999999-9999-4999-8999-999999999999",
        unit_price_cents: 300,
        price_kind: "per_day",
        quantity: 1,
      }),
    ];

    expect(lineAddonsTotal(rows, 4)).toBe(500 + 1200);
    // 2026-03-04 to 2026-03-08 is four days, the same arithmetic the board uses.
    expect(bookingAddonsTotal(rows, "2026-03-04", "2026-03-08")).toBe(1700);
  });

  it("spells out the unit beside the price", () => {
    expect(addonPriceLabel(500, "per_booking", "usd")).toBe(
      "$5.00 per booking",
    );
    expect(addonPriceLabel(500, "per_day", "usd")).toBe("$5.00 per day");
  });
});

describe("which products an extra goes with", () => {
  const parent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sibling = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("offers an unscoped extra with everything, including a blank line", () => {
    // A workspace without the products section has no products to scope to, and
    // a line may name no product at all: both cases are "offered".
    expect(isAddonOfferedFor([], { product_id: null, parent_id: null })).toBe(
      true,
    );
    expect(
      isAddonOfferedFor([], { product_id: PRODUCT_ID, parent_id: null }),
    ).toBe(true);
  });

  it("matches the exact product", () => {
    expect(
      isAddonOfferedFor([PRODUCT_ID], {
        product_id: PRODUCT_ID,
        parent_id: null,
      }),
    ).toBe(true);
  });

  it("matches a variant through its parent", () => {
    // Scoping a helmet to "Mountain bike" has to cover the medium and the large.
    expect(
      isAddonOfferedFor([parent], { product_id: PRODUCT_ID, parent_id: parent }),
    ).toBe(true);
  });

  it("does not match a sibling variant", () => {
    // The large's helmet is not the small's.
    expect(
      isAddonOfferedFor([sibling], {
        product_id: PRODUCT_ID,
        parent_id: parent,
      }),
    ).toBe(false);
  });

  it("does not match a line that names no product", () => {
    expect(
      isAddonOfferedFor([PRODUCT_ID], { product_id: null, parent_id: null }),
    ).toBe(false);
  });

  it("groups scope rows by add-on", () => {
    const scope = addonScopeByAddon([
      { addon_id: ADDON_ID, product_id: PRODUCT_ID },
      { addon_id: ADDON_ID, product_id: parent },
      { addon_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", product_id: parent },
    ]);

    expect(scope.get(ADDON_ID)).toEqual([PRODUCT_ID, parent]);
    expect(scope.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toEqual([parent]);
  });
});

describe("the extras a line is offered", () => {
  it("hides an archived extra and one scoped to another product", () => {
    const helmet = addonRow();
    const archived = addonRow({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      handle: "lock",
      status: "archived",
    });
    const elsewhere = addonRow({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      handle: "child-seat",
    });

    const offered = addonsForLine(
      [helmet, archived, elsewhere],
      new Map([[elsewhere.id, ["ffffffff-ffff-4fff-8fff-ffffffffffff"]]]),
      { product_id: PRODUCT_ID, parent_id: null },
    );

    expect(offered.map((addon) => addon.handle)).toEqual(["helmet"]);
  });

  it("offers everything active when nothing is scoped", () => {
    // The products section can be switched off entirely; the catalogue still has
    // to work, which is what "no rows means every product" buys.
    const offered = addonsForLine(
      [addonRow(), addonRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })],
      new Map(),
      { product_id: null, parent_id: null },
    );

    expect(offered).toHaveLength(2);
  });
});

describe("the catalogue form", () => {
  it("reads a complete row", () => {
    const parsed = parseAddonDraft(
      formDataOf({
        name: "Child seat",
        handle: "child-seat",
        description: "Fits up to 22kg.",
        price: "7.50",
        price_kind: "per_day",
        max_quantity: "2",
        status: "active",
      }),
    );

    expect(parsed).toEqual({
      draft: {
        name: "Child seat",
        handle: "child-seat",
        description: "Fits up to 22kg.",
        price_cents: 750,
        price_kind: "per_day",
        max_quantity: 2,
        track_stock: false,
        quantity_on_hand: 0,
        status: "active",
      },
    });
  });

  it("defaults to one per line, charged per booking", () => {
    const parsed = parseAddonDraft(formDataOf({ name: "Helmet" }));

    expect(parsed).toEqual({
      draft: {
        name: "Helmet",
        handle: "helmet",
        description: null,
        price_cents: 0,
        price_kind: "per_booking",
        max_quantity: 1,
        track_stock: false,
        quantity_on_hand: 0,
        status: "active",
      },
    });
  });

  it("keeps the address an edit did not touch", () => {
    // Clearing the field must not move a URL somebody bookmarked.
    const parsed = parseAddonDraft(
      formDataOf({ name: "Lights", current_handle: "bike-lights" }),
    );

    expect(parsed).toMatchObject({ draft: { handle: "bike-lights" } });
  });

  it("refuses a name, an address or a price it cannot store", () => {
    expect(parseAddonDraft(formDataOf({ name: " " }))).toEqual({
      error: "Give the extra a name, for example Helmet.",
    });
    expect(parseAddonDraft(formDataOf({ name: "Helmet", handle: "new" }))).toEqual(
      { error: "That address is reserved by the section. Please pick another." },
    );
    expect(parseAddonDraft(formDataOf({ name: "Helmet", price: "12.345" }))).toEqual(
      { error: "Enter a price like 12.50." },
    );
  });

  it("refuses a price kind or a status the enum does not have", () => {
    expect(
      parseAddonDraft(formDataOf({ name: "Helmet", price_kind: "per_week" })),
    ).toEqual({
      error: "Choose whether the extra is charged per booking or per day.",
    });
    expect(
      parseAddonDraft(formDataOf({ name: "Helmet", status: "deleted" })),
    ).toEqual({ error: "Choose whether the extra is on offer or archived." });
  });

  it("refuses a ceiling above one per line when the field is zero", () => {
    expect(
      parseAddonDraft(formDataOf({ name: "Helmet", max_quantity: "0" })),
    ).toEqual({ error: "Choose at least one." });
  });
});

describe("how many of an extra the shop owns", () => {
  it("looks at the figure only when the extra is counted", () => {
    // An unlimited extra's number is never read, so a stale one is harmless.
    expect(addonStockProblem(false, -5)).toBeNull();
    expect(addonStockProblem(false, MAX_ADDON_STOCK + 1)).toBeNull();
  });

  it("refuses a count it cannot store", () => {
    expect(addonStockProblem(true, -1)).toContain("whole number");
    expect(addonStockProblem(true, 1.5)).toContain("whole number");
    expect(addonStockProblem(true, MAX_ADDON_STOCK + 1)).toContain(
      `under ${MAX_ADDON_STOCK + 1}`,
    );
    expect(addonStockProblem(true, 0)).toBeNull();
    expect(addonStockProblem(true, 6)).toBeNull();
  });

  it("says which of the two the catalogue row is", () => {
    expect(addonStockLabel({ track_stock: false, quantity_on_hand: 0 })).toBe(
      "Unlimited",
    );
    expect(addonStockLabel({ track_stock: true, quantity_on_hand: 6 })).toBe(
      "6 in stock",
    );
  });

  it("reads the checkbox and the count off the form", () => {
    const parsed = parseAddonDraft(
      formDataOf({
        name: "Helmet",
        track_stock: "on",
        quantity_on_hand: "6",
      }),
    );

    expect(parsed).toMatchObject({
      draft: { track_stock: true, quantity_on_hand: 6 },
    });
  });

  it("treats an unticked checkbox as unlimited", () => {
    // A checkbox posts nothing when it is not ticked, which is the whole reason
    // the field is read as "present or absent" rather than as a boolean string.
    const parsed = parseAddonDraft(
      formDataOf({ name: "Helmet", quantity_on_hand: "6" }),
    );

    expect(parsed).toMatchObject({
      draft: { track_stock: false, quantity_on_hand: 6 },
    });
  });

  it("refuses a negative count on a counted extra", () => {
    expect(
      parseAddonDraft(
        formDataOf({ name: "Helmet", track_stock: "on", quantity_on_hand: "-1" }),
      ),
    ).toEqual({ error: "Enter how many the shop owns, as a whole number." });
  });
});

