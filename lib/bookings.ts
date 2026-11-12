import {
  formatPriceCents,
  isIsoDate,
  parsePriceCents,
} from "@/lib/products";
import { slugify } from "@/lib/slug";
import type {
  BookingChannel,
  BookingStatus,
  Tables,
} from "@/lib/supabase/types";

/**
 * Booking rules shared by the section's pages, its Server Actions and its tests.
 *
 * Like `lib/assets.ts` this module is free of `server-only` and of any database
 * import, so a Server Component and a Client Component can agree on what a valid
 * window, reference or transition is. Authorization is *not* here — it is in the
 * Server Actions and in RLS.
 *
 * The one rule that must never drift: windows are half-open,
 * `[starts_on, ends_on)`, in the SQL constraint, in `check_asset_availability()`
 * and in `rangesOverlap`/`bookingDays` below. A booking that ends on the 5th
 * does not include the 5th, which is what makes a same-day handover legal.
 */

export type Booking = Tables<"bookings">;
export type BookingLineItem = Tables<"booking_line_items">;
export type Customer = Tables<"customers">;
export type RiderPreference = Tables<"rider_preferences">;

// -----------------------------------------------------------------------------
// Statuses
// -----------------------------------------------------------------------------
export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "out",
  "returned",
  "cancelled",
] as const satisfies readonly BookingStatus[];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  out: "Out",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const BOOKING_STATUS_OPTIONS = BOOKING_STATUSES.map((status) => ({
  value: status,
  label: BOOKING_STATUS_LABELS[status],
  description:
    status === "pending"
      ? "Taken, but not yet promised to a particular unit."
      : status === "confirmed"
        ? "Promised, and holding its units for the window."
        : status === "out"
          ? "With the renter. The units stay held until they come back."
          : status === "returned"
            ? "Came back, so the units are free again."
            : "Called off. The lines keep their history and release their units.",
}));

export function isBookingStatus(value: unknown): value is BookingStatus {
  return (
    typeof value === "string" &&
    (BOOKING_STATUSES as readonly string[]).includes(value)
  );
}

export const BOOKING_CHANNELS = [
  "staff",
  "api",
] as const satisfies readonly BookingChannel[];

export const BOOKING_CHANNEL_LABELS: Record<BookingChannel, string> = {
  staff: "Taken at the desk",
  api: "Booked online",
};

export function isBookingChannel(value: unknown): value is BookingChannel {
  return (
    typeof value === "string" &&
    (BOOKING_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * The statuses that still hold a unit.
 *
 * Mirrors the body of `public.booking_blocks_stock()` in migration 13, which is
 * what the exclusion constraint reads. `tests/db/schema.test.ts` fails if the two
 * lists drift, and `tests/unit/bookings.test.ts` pins the SQL side of the pair.
 */
export const BLOCKING_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "out",
] as const satisfies readonly BookingStatus[];

/** True while a booking in this status reserves the units on its lines. */
export function holdsUnit(status: BookingStatus): boolean {
  return (BLOCKING_BOOKING_STATUSES as readonly BookingStatus[]).includes(
    status,
  );
}

/**
 * What the desk may do next, per status.
 *
 * Backwards moves are deliberately absent: a unit that came back cannot be
 * "un-returned" by a status click, because the shop would be claiming it has a
 * bike it does not. Reinstating a cancelled booking is a new booking.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["out", "cancelled"],
  out: ["returned"],
  returned: [],
  cancelled: [],
};

/** The next statuses a booking may move to, in the order the page offers them. */
export function nextBookingStatuses(status: BookingStatus): BookingStatus[] {
  return BOOKING_TRANSITIONS[status];
}

/** True when `from -> to` is a move the desk is allowed to make. */
export function canMoveBooking(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

// -----------------------------------------------------------------------------
// Reading order
// -----------------------------------------------------------------------------
/**
 * The orders the board can be read in.
 *
 * `soonest` is the default because a board is worked forwards: the next handover
 * is the top row. `status` groups by the enum's own order — pending, confirmed,
 * out, returned, cancelled — which is the order a shift works through them.
 */
export const BOOKING_SORT_OPTIONS = [
  { value: "soonest", label: "Starts soonest" },
  { value: "latest", label: "Starts latest" },
  { value: "newest", label: "Newest first" },
  { value: "status", label: "Status" },
] as const;

export type BookingSort = (typeof BOOKING_SORT_OPTIONS)[number]["value"];

/** The `?sort=` to use, falling back to `soonest` for anything unknown. */
export function readBookingSort(value: unknown): BookingSort {
  return (
    BOOKING_SORT_OPTIONS.find((option) => option.value === value)?.value ??
    "soonest"
  );
}

// -----------------------------------------------------------------------------
// References
// -----------------------------------------------------------------------------
/**
 * The alphabet a generated reference uses: no `0`/`O` and no `1`/`I`, because a
 * reference is read down a telephone line and typed into a second system.
 */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const REFERENCE_LENGTH = 6;

/** Mirrors the `bookings.reference` CHECK in migration 13. */
const BOOKING_REFERENCE = /^BK-[0-9A-Z]{6}$/;

/**
 * Builds a reference from a random source, so a test can pass a fixed one.
 *
 * `random` is `Math.random` in the action. It is not a security boundary — the
 * unique index on `(company_id, reference)` is what stops a repeat, and the
 * action retries on `23505`.
 */
export function bookingReferenceFrom(random: () => number): string {
  let code = "";

  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    // Clamped because a hand-written source may return exactly 1.
    const pick = Math.min(
      REFERENCE_ALPHABET.length - 1,
      Math.floor(random() * REFERENCE_ALPHABET.length),
    );
    code += REFERENCE_ALPHABET[pick];
  }

  return `BK-${code}`;
}

/** Explains what is wrong with a reference, or `null` when it is usable. */
export function bookingReferenceProblem(reference: string): string | null {
  if (reference.length === 0) {
    return "A booking needs a reference.";
  }
  if (!BOOKING_REFERENCE.test(reference)) {
    return "A booking reference looks like BK-7F3K2Q.";
  }
  return null;
}

// -----------------------------------------------------------------------------
// Windows
// -----------------------------------------------------------------------------
const DAY_MS = 86_400_000;

/**
 * Validates a booking window.
 *
 * Stricter than `lib/products.ts`'s helper of the same name: `[start, end)` must
 * contain at least one day, so a zero-length window is refused even though a
 * *shared handover day* between two bookings is legal. A booking that holds
 * nothing would only ever be a typo.
 */
export function dateRangeProblem(
  startsOn: string,
  endsOn: string,
): string | null {
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) {
    return "Choose a collection and a return date.";
  }
  if (endsOn <= startsOn) {
    return "The return date must be after the collection date.";
  }
  return null;
}

/**
 * How many days the unit is out: `[starts_on, ends_on)` in whole days.
 *
 * Read as UTC for the same reason `formatDateRange` does: a `date` column carries
 * no zone, and the count must not move with the server's clock.
 */
export function bookingDays(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) return 0;

  return Math.max(0, Math.round((end - start) / DAY_MS));
}

/**
 * Whether two half-open windows share a day.
 *
 * `[a, b)` and `[b, c)` do not overlap: the unit comes back on `b` and may go out
 * again on `b`. This is the comparison the GiST constraint makes, so the page can
 * warn about a clash before the insert is refused.
 */
export function rangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

/** "Mar 4, 2026 – Mar 8, 2026 · 4 days", for the board and the detail page. */
export function formatBookingWindow(startsOn: string, endsOn: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      // `date` columns carry no zone; reading them as UTC keeps the day the
      // operator typed, wherever the server happens to run.
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));

  const days = bookingDays(startsOn, endsOn);

  return `${format(startsOn)} – ${format(endsOn)} · ${
    days === 1 ? "1 day" : `${days} days`
  }`;
}

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------
/** What one line costs: the price the desk typed times the quantity. */
export function lineItemTotal(
  line: Pick<BookingLineItem, "unit_price_cents" | "quantity">,
): number {
  return line.unit_price_cents * line.quantity;
}

export type BookingTotals = {
  lineCount: number;
  totalCents: number;
};

/**
 * The booking's value, derived from its lines every render.
 *
 * Nothing stores a total: a price edited on a line changes the figure with it,
 * for the same reason availability is counted rather than kept.
 */
export function bookingTotals(
  lines: readonly Pick<BookingLineItem, "unit_price_cents" | "quantity">[],
): BookingTotals {
  let totalCents = 0;

  for (const line of lines) {
    totalCents += lineItemTotal(line);
  }

  return { lineCount: lines.length, totalCents };
}

/** Formats an amount the same way the catalogue and the plan picker do. */
export function formatBookingPrice(cents: number, currency: string): string {
  return formatPriceCents(cents, currency);
}

// -----------------------------------------------------------------------------
// Renters
// -----------------------------------------------------------------------------
/**
 * The longest base a generated renter handle may have.
 *
 * The column's CHECK allows 50 characters and a collision suffix adds up to
 * three (`-10`), so 44 leaves room without ever crossing the limit.
 */
const RENTER_HANDLE_BASE_LENGTH = 44;

/**
 * A handle for a renter created from the booking form.
 *
 * `attempt` counts collisions with renters already in the workspace: the unique
 * index on `(company_id, handle)` is what decides, and the action asks again with
 * the next number rather than showing the desk a `23505`.
 */
export function customerHandleFrom(fullName: string, attempt = 0): string {
  const slug = slugify(fullName);
  // The column's CHECK needs three characters, so "Bo" becomes "rider-bo".
  const base = (slug.length >= 3 ? slug : `rider-${slug || "new"}`)
    .slice(0, RENTER_HANDLE_BASE_LENGTH)
    .replace(/-+$/, "");

  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

// -----------------------------------------------------------------------------
// The forms
// -----------------------------------------------------------------------------
/**
 * The id the "new booking" panel's footer button targets.
 *
 * `FormSheet` keeps its submit button outside the `<form>`, so the panel and the
 * fields have to agree on this string; it lives here, away from both.
 */
export const NEW_BOOKING_FORM_ID = "booking-new-form";

/** The inline "new renter" fields the booking form may carry. */
export type NewCustomerDraft = {
  full_name: string;
  email: string | null;
  phone: string | null;
};

/**
 * A booking row, as the create and edit forms submit it.
 *
 * On create exactly one of `customer_id` and `new_customer` is set: the desk
 * either picks a renter the workspace already knows or types a walk-in in. An
 * edit sends `customer_id` only — changing who booked is a different
 * conversation, and the action refuses a renter it cannot see anyway.
 */
export type BookingDraft = {
  customer_id: string | null;
  new_customer: NewCustomerDraft | null;
  starts_on: string;
  ends_on: string;
  status: BookingStatus;
  notes: string | null;
};

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads and validates the fields shared by creating and editing a booking.
 *
 * The reference and the channel are deliberately absent: the action generates
 * one and sets the other, so a form cannot claim a booking came from the API.
 */
export function parseBookingDraft(
  formData: FormData,
): { draft: BookingDraft } | { error: string } {
  const customerId = field(formData, "customer_id");
  const newName = field(formData, "new_customer_name");

  if (!customerId && !newName) {
    return { error: "Choose a renter, or add a new one." };
  }
  if (newName && newName.length < 2) {
    return { error: "A new renter needs a name." };
  }
  if (newName && newName.length > 120) {
    return { error: "That name is too long." };
  }

  const startsOn = field(formData, "starts_on");
  const endsOn = field(formData, "ends_on");
  const rangeProblem = dateRangeProblem(startsOn, endsOn);
  if (rangeProblem) {
    return { error: rangeProblem };
  }

  const status = field(formData, "status") || "pending";
  if (!isBookingStatus(status)) {
    return { error: "Choose a valid status." };
  }

  return {
    draft: {
      customer_id: customerId || null,
      new_customer: newName
        ? {
            full_name: newName,
            email: field(formData, "new_customer_email") || null,
            phone: field(formData, "new_customer_phone") || null,
          }
        : null,
      starts_on: startsOn,
      ends_on: endsOn,
      status,
      notes: field(formData, "notes") || null,
    },
  };
}

/** A line item, as the add/edit form submits it. */
export type LineItemDraft = {
  product_id: string | null;
  asset_id: string | null;
  quantity: number;
  unit_price_cents: number;
};

/** The largest quantity one line may carry. A shelf of bikes is 99 hires. */
export const MAX_LINE_QUANTITY = 99;

/**
 * Reads and validates a line item.
 *
 * The window is not read: `booking_line_items_sync` copies it from the parent,
 * so a line cannot be given dates the booking never had.
 */
export function parseLineItemDraft(
  formData: FormData,
): { draft: LineItemDraft } | { error: string } {
  const quantity = Number.parseInt(field(formData, "quantity") || "1", 10);
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_LINE_QUANTITY
  ) {
    return { error: `Choose a quantity between 1 and ${MAX_LINE_QUANTITY}.` };
  }

  const priceRaw = field(formData, "unit_price");
  const unitPriceCents = priceRaw === "" ? 0 : parsePriceCents(priceRaw);
  if (unitPriceCents === null) {
    return { error: "Enter a price like 12.50." };
  }

  return {
    draft: {
      product_id: field(formData, "product_id") || null,
      asset_id: field(formData, "asset_id") || null,
      quantity,
      unit_price_cents: unitPriceCents,
    },
  };
}
