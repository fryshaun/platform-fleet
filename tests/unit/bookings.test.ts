import { describe, expect, it } from "vitest";

import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_CHANNELS,
  BOOKING_CHANNEL_LABELS,
  BOOKING_SORT_OPTIONS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_OPTIONS,
  BOOKING_TRANSITIONS,
  bookingDays,
  bookingReferenceFrom,
  bookingReferenceProblem,
  bookingTotals,
  canMoveBooking,
  dateRangeProblem,
  formatBookingPrice,
  formatBookingWindow,
  holdsUnit,
  isBookingChannel,
  isBookingStatus,
  lineItemTotal,
  MAX_LINE_QUANTITY,
  nextBookingStatuses,
  parseBookingDraft,
  parseLineItemDraft,
  readBookingSort,
  rangesOverlap,
} from "@/lib/bookings";

import {
  ASSET_ID,
  CUSTOMER_ID,
  PRODUCT_ID,
  formDataOf,
  lineItemRow,
} from "../helpers/fixtures";

describe("booking statuses", () => {
  it("offers a label and an explanation for every status", () => {
    expect(BOOKING_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...BOOKING_STATUSES,
    ]);

    for (const option of BOOKING_STATUS_OPTIONS) {
      expect(option.label).toBe(BOOKING_STATUS_LABELS[option.value]);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it("recognises only the five statuses", () => {
    for (const status of BOOKING_STATUSES) {
      expect(isBookingStatus(status)).toBe(true);
    }

    expect(isBookingStatus("rented")).toBe(false);
    expect(isBookingStatus(null)).toBe(false);
  });

  it("holds a unit in the first three statuses and releases it in the last two", () => {
    // The same split `booking_blocks_stock()` makes in SQL.
    expect([...BLOCKING_BOOKING_STATUSES]).toEqual([
      "pending",
      "confirmed",
      "out",
    ]);
    expect(BOOKING_STATUSES.filter(holdsUnit)).toEqual([
      ...BLOCKING_BOOKING_STATUSES,
    ]);
    expect(holdsUnit("returned")).toBe(false);
    expect(holdsUnit("cancelled")).toBe(false);
  });

  it("names the two channels", () => {
    expect(BOOKING_CHANNELS).toEqual(["staff", "api"]);
    expect(Object.keys(BOOKING_CHANNEL_LABELS).sort()).toEqual([
      "api",
      "staff",
    ]);
    expect(isBookingChannel("staff")).toBe(true);
    expect(isBookingChannel("phone")).toBe(false);
  });
});

describe("booking transitions", () => {
  it("never offers a status as its own next move", () => {
    for (const status of BOOKING_STATUSES) {
      expect(BOOKING_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("walks a booking forwards", () => {
    expect(nextBookingStatuses("pending")).toEqual(["confirmed", "cancelled"]);
    expect(nextBookingStatuses("confirmed")).toEqual(["out", "cancelled"]);
    expect(nextBookingStatuses("out")).toEqual(["returned"]);
  });

  it("treats a finished booking as finished", () => {
    // A unit that came back cannot be "un-returned" by a status click.
    expect(nextBookingStatuses("returned")).toEqual([]);
    expect(nextBookingStatuses("cancelled")).toEqual([]);
  });

  it("only allows the moves it lists", () => {
    expect(canMoveBooking("pending", "out")).toBe(false);
    expect(canMoveBooking("confirmed", "out")).toBe(true);
    expect(canMoveBooking("returned", "out")).toBe(false);
    expect(canMoveBooking("cancelled", "pending")).toBe(false);
  });

  it("never offers a next move that is not in the table", () => {
    for (const status of BOOKING_STATUSES) {
      for (const next of nextBookingStatuses(status)) {
        expect(isBookingStatus(next)).toBe(true);
      }
    }
  });
});

describe("booking references", () => {
  it("builds a reference from the random source it is given", () => {
    expect(bookingReferenceFrom(() => 0)).toBe("BK-222222");
  });

  it("clamps a source that returns exactly one", () => {
    expect(bookingReferenceFrom(() => 1)).toBe("BK-ZZZZZZ");
  });

  it("never emits a character that is easy to misread", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(bookingReferenceFrom(Math.random)).toMatch(/^BK-[2-9A-HJ-NP-Z]{6}$/);
    }
  });

  it("accepts a generated reference and explains a bad one", () => {
    expect(bookingReferenceProblem("BK-7F3K2Q")).toBeNull();
    expect(bookingReferenceProblem("")).toContain("reference");
    expect(bookingReferenceProblem("7F3K2Q")).toContain("BK-");
    expect(bookingReferenceProblem("BK-7F3K2")).toContain("BK-");
    expect(bookingReferenceProblem("BK-7f3k2q")).toContain("BK-");
  });
});

describe("booking windows", () => {
  it("refuses a window that holds no day", () => {
    // Half-open: `[d, d)` is empty, so it is a typo rather than a one-day hire.
    expect(dateRangeProblem("2026-03-04", "2026-03-04")).toBe(
      "The return date must be after the collection date.",
    );
    expect(dateRangeProblem("2026-03-05", "2026-03-04")).toContain("after");
  });

  it("accepts a window and rejects a malformed date", () => {
    expect(dateRangeProblem("2026-03-04", "2026-03-05")).toBeNull();
    expect(dateRangeProblem("", "2026-03-05")).toContain("Choose");
    expect(dateRangeProblem("04/03/2026", "2026-03-05")).toContain("Choose");
  });

  it("counts whole days, half-open", () => {
    expect(bookingDays("2026-03-04", "2026-03-08")).toBe(4);
    expect(bookingDays("2026-03-04", "2026-03-05")).toBe(1);
    expect(bookingDays("2026-03-04", "2026-03-04")).toBe(0);
    expect(bookingDays("nonsense", "2026-03-05")).toBe(0);
  });

  it("counts across a month end and a leap day without drifting", () => {
    expect(bookingDays("2028-02-28", "2028-03-01")).toBe(2);
    expect(bookingDays("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("lets one booking start on the day the previous one ends", () => {
    // The whole reason windows are half-open: the unit comes back in the morning
    // and goes out again the same day.
    expect(
      rangesOverlap("2026-03-01", "2026-03-05", "2026-03-05", "2026-03-08"),
    ).toBe(false);
    expect(
      rangesOverlap("2026-03-01", "2026-03-05", "2026-03-04", "2026-03-08"),
    ).toBe(true);
    expect(
      rangesOverlap("2026-03-05", "2026-03-08", "2026-03-01", "2026-03-05"),
    ).toBe(false);
    expect(
      rangesOverlap("2026-03-01", "2026-03-10", "2026-03-03", "2026-03-04"),
    ).toBe(true);
  });

  it("reads the window and its length in one sentence", () => {
    expect(formatBookingWindow("2026-03-04", "2026-03-08")).toBe(
      "Mar 4, 2026 – Mar 8, 2026 · 4 days",
    );
    expect(formatBookingWindow("2026-03-04", "2026-03-05")).toContain("1 day");
    expect(formatBookingWindow("2026-03-04", "2026-03-05")).not.toContain(
      "1 days",
    );
  });
});

describe("booking money", () => {
  it("multiplies the price by the quantity", () => {
    expect(lineItemTotal({ unit_price_cents: 4500, quantity: 1 })).toBe(4500);
    expect(lineItemTotal({ unit_price_cents: 4500, quantity: 3 })).toBe(13500);
    expect(lineItemTotal({ unit_price_cents: 0, quantity: 9 })).toBe(0);
  });

  it("sums the lines and counts them", () => {
    expect(
      bookingTotals([
        lineItemRow(),
        lineItemRow({ unit_price_cents: 1000, quantity: 2 }),
      ]),
    ).toEqual({ lineCount: 2, totalCents: 6500 });
    expect(bookingTotals([])).toEqual({ lineCount: 0, totalCents: 0 });
  });

  it("formats an amount the way the catalogue does", () => {
    expect(formatBookingPrice(4500, "usd")).toBe("$45.00");
    expect(formatBookingPrice(0, "usd")).toBe("$0.00");
  });
});

describe("booking sorts", () => {
  it("defaults to the soonest handover", () => {
    expect(readBookingSort(undefined)).toBe("soonest");
    expect(readBookingSort("nonsense")).toBe("soonest");
  });

  it("keeps every option it offers", () => {
    for (const option of BOOKING_SORT_OPTIONS) {
      expect(readBookingSort(option.value)).toBe(option.value);
    }
  });
});

describe("parseBookingDraft", () => {
  const DRAFT = {
    customer_id: CUSTOMER_ID,
    starts_on: "2026-03-04",
    ends_on: "2026-03-08",
  };

  it("reads a complete form", () => {
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, notes: "  early pickup  " })),
    ).toEqual({
      draft: {
        customer_id: CUSTOMER_ID,
        starts_on: "2026-03-04",
        ends_on: "2026-03-08",
        status: "pending",
        notes: "early pickup",
      },
    });
  });

  it("requires a renter", () => {
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, customer_id: "  " })),
    ).toEqual({ error: "Choose a renter first." });
  });

  it("refuses a window the constraint would refuse", () => {
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, ends_on: "2026-03-04" })),
    ).toEqual({
      error: "The return date must be after the collection date.",
    });
  });

  it("keeps a status it recognises and refuses one it does not", () => {
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, status: "confirmed" })),
    ).toMatchObject({ draft: { status: "confirmed" } });
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, status: "rented" })),
    ).toEqual({ error: "Choose a valid status." });
  });

  it("treats a blank note as absent", () => {
    expect(
      parseBookingDraft(formDataOf({ ...DRAFT, notes: "   " })),
    ).toMatchObject({ draft: { notes: null } });
  });
});

describe("parseLineItemDraft", () => {
  it("defaults to one unit and no money", () => {
    expect(parseLineItemDraft(formDataOf({}))).toEqual({
      draft: {
        product_id: null,
        asset_id: null,
        quantity: 1,
        unit_price_cents: 0,
      },
    });
  });

  it("reads a priced, allocated line", () => {
    expect(
      parseLineItemDraft(
        formDataOf({
          product_id: PRODUCT_ID,
          asset_id: ASSET_ID,
          quantity: "2",
          unit_price: "45",
        }),
      ),
    ).toEqual({
      draft: {
        product_id: PRODUCT_ID,
        asset_id: ASSET_ID,
        quantity: 2,
        unit_price_cents: 4500,
      },
    });
  });

  it("refuses a quantity that is not a count", () => {
    for (const quantity of ["0", `${MAX_LINE_QUANTITY + 1}`, "two", "-1"]) {
      expect(parseLineItemDraft(formDataOf({ quantity }))).toEqual({
        error: `Choose a quantity between 1 and ${MAX_LINE_QUANTITY}.`,
      });
    }
  });

  it("refuses money it cannot store", () => {
    expect(parseLineItemDraft(formDataOf({ unit_price: "12.345" }))).toEqual({
      error: "Enter a price like 12.50.",
    });
  });

  it("never reads a window from the form", () => {
    // `booking_line_items_sync` copies the window from the booking, so a posted
    // date must not reach the row.
    expect(
      parseLineItemDraft(
        formDataOf({ starts_on: "2020-01-01", ends_on: "2020-01-02" }),
      ),
    ).toEqual({
      draft: {
        product_id: null,
        asset_id: null,
        quantity: 1,
        unit_price_cents: 0,
      },
    });
  });
});
