import { bookingDays, formatBookingPrice } from "@/lib/bookings";
import { parsePriceCents } from "@/lib/products";
import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import type {
  AddonPriceKind,
  AddonStatus,
  Tables,
} from "@/lib/supabase/types";

/**
 * Extras rules shared by the catalogue page, the booking page, the Server
 * Actions and the tests.
 *
 * Like `lib/bookings.ts` this module is free of `server-only` and of any database
 * import, so a Server Component and a Client Component can agree on what an
 * extra costs and which products it goes with. Authorization is not here — it is
 * in the Server Actions and in RLS.
 *
 * Three rules are worth stating once, because the SQL repeats them:
 *
 *   1. `per_day` multiplies by the booking window, counted in whole days with a
 *      floor of one — a same-day collection is still a day's hire.
 *   2. An extra with **no** scope rows is offered with every product; one with
 *      rows is offered with those products and their variants.
 *   3. The price on a booking line is a *snapshot*. Changing the catalogue price
 *      never re-prices a hire that already took the extra.
 */

export type Addon = Tables<"addons">;
export type AddonProduct = Tables<"addon_products">;
export type BookingLineAddon = Tables<"booking_line_addons">;

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------
export const ADDON_PRICE_KINDS = [
  "per_booking",
  "per_day",
] as const satisfies readonly AddonPriceKind[];

export const ADDON_PRICE_KIND_LABELS: Record<AddonPriceKind, string> = {
  per_booking: "Per booking",
  per_day: "Per day",
};

export const ADDON_PRICE_KIND_OPTIONS = ADDON_PRICE_KINDS.map((kind) => ({
  value: kind,
  label: ADDON_PRICE_KIND_LABELS[kind],
  description:
    kind === "per_booking"
      ? "Charged once, however long the hire runs."
      : "Charged for each day of the booking window.",
}));

export function isAddonPriceKind(value: unknown): value is AddonPriceKind {
  return (
    typeof value === "string" &&
    (ADDON_PRICE_KINDS as readonly string[]).includes(value)
  );
}

export const ADDON_STATUSES = [
  "active",
  "archived",
] as const satisfies readonly AddonStatus[];

export const ADDON_STATUS_LABELS: Record<AddonStatus, string> = {
  active: "On offer",
  archived: "Archived",
};

export function isAddonStatus(value: unknown): value is AddonStatus {
  return (
    typeof value === "string" &&
    (ADDON_STATUSES as readonly string[]).includes(value)
  );
}

// -----------------------------------------------------------------------------
// Handles and names
// -----------------------------------------------------------------------------
/**
 * Segments `/bookings/add-ons` may want for its own pages one day. Kept beside
 * the other handle rules so a catalogue row cannot claim a route.
 */
export const RESERVED_ADDON_HANDLES = new Set(["new"]);

/** Explains what is wrong with an extra's handle, or `null` when it is usable. */
export function addonHandleProblem(handle: string): string | null {
  if (RESERVED_ADDON_HANDLES.has(handle)) {
    return "That address is reserved by the section. Please pick another.";
  }
  if (handle.length === 0) {
    return "Enter an address for the extra.";
  }

  const problem = validateSlug(handle);
  return problem ? SLUG_PROBLEM_MESSAGES[problem] : null;
}

/** Turns a name into a handle, the same way products and assets do. */
export function deriveAddonHandle(name: string): string {
  return slugify(name);
}

/** Mirrors `length(trim(name)) between 1 and 120` in the database. */
export function addonNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Give the extra a name, for example Helmet.";
  }
  if (trimmed.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/** The most one booking line may take of any extra; a catalogue row may set less. */
export const MAX_ADDON_QUANTITY = 99;

/** The most an extra's shelf may hold. Mirrors the column's CHECK. */
export const MAX_ADDON_STOCK = 9999;

/**
 * Explains why a stock figure is not allowed, or `null`.
 *
 * Only checked when the extra is counted: an unlimited extra's `quantity_on_hand`
 * is not read anywhere, so a stale number there is harmless and stays as typed.
 */
export function addonStockProblem(
  trackStock: boolean,
  quantityOnHand: number,
): string | null {
  if (!trackStock) return null;
  if (!Number.isInteger(quantityOnHand) || quantityOnHand < 0) {
    return "Enter how many the shop owns, as a whole number.";
  }
  if (quantityOnHand > MAX_ADDON_STOCK) {
    return `Keep the stock figure under ${MAX_ADDON_STOCK + 1}.`;
  }
  return null;
}

/** "Unlimited" or "6 in stock", for the catalogue card. */
export function addonStockLabel(
  addon: Pick<Addon, "track_stock" | "quantity_on_hand">,
): string {
  return addon.track_stock
    ? `${addon.quantity_on_hand} in stock`
    : "Unlimited";
}

/** Explains why a quantity is not allowed for this extra, or `null`. */
export function addonQuantityProblem(
  quantity: number,
  maxQuantity: number,
): string | null {
  const ceiling = Math.min(maxQuantity, MAX_ADDON_QUANTITY);

  if (!Number.isInteger(quantity) || quantity < 1) {
    return "Choose at least one.";
  }
  if (quantity > ceiling) {
    return ceiling === 1
      ? "One of these per line is the most this workspace allows."
      : `At most ${ceiling} of these per line.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------
/** What one row of extras costs, given how long the hire runs. */
export function addonChargeCents(
  row: Pick<BookingLineAddon, "unit_price_cents" | "price_kind" | "quantity">,
  days: number,
): number {
  const base = row.unit_price_cents * row.quantity;
  if (row.price_kind === "per_booking") return base;

  // A day of hire is a day: an empty or nonsensical window still charges once,
  // which is what the desk means when they hand something over and take it back
  // the same afternoon.
  return base * Math.max(1, Math.round(days));
}

/** The extras on one line, priced against the booking's window. */
export function lineAddonsTotal(
  rows: readonly Pick<
    BookingLineAddon,
    "unit_price_cents" | "price_kind" | "quantity"
  >[],
  days: number,
): number {
  let total = 0;
  for (const row of rows) {
    total += addonChargeCents(row, days);
  }
  return total;
}

/** The extras on a whole booking, priced against its window. */
export function bookingAddonsTotal(
  rows: readonly Pick<
    BookingLineAddon,
    "unit_price_cents" | "price_kind" | "quantity"
  >[],
  startsOn: string,
  endsOn: string,
): number {
  return lineAddonsTotal(rows, bookingDays(startsOn, endsOn));
}

/**
 * "5.00 per day", for the catalogue and the picker.
 *
 * The unit is spelled out because `5.00` beside a three-day hire reads as the
 * total otherwise.
 */
export function addonPriceLabel(
  cents: number,
  kind: AddonPriceKind,
  currency: string,
): string {
  const unit = ADDON_PRICE_KIND_LABELS[kind].toLowerCase();
  return `${formatBookingPrice(cents, currency)} ${unit}`;
}

/**
 * The DOM id of the "new extra" panel's form.
 *
 * The panel keeps its submit button in a footer *outside* the `<form>` — that is
 * what lets Cancel and Add extra sit side by side — so the button and the form
 * have to agree on this string. It lives here so neither side can drift.
 */
export const NEW_ADDON_FORM_ID = "addon-new-form";

// -----------------------------------------------------------------------------
// Which products an extra goes with
// -----------------------------------------------------------------------------
/**
 * Whether an extra is offered with a line's product.
 *
 * `scopedProductIds` is that extra's rows in `addon_products`. Empty means the
 * catalogue row is unscoped — the case a workspace without the products section
 * lives in.
 *
 * A variant matches its parent: a shop that scopes a helmet to "Mountain bike"
 * means the medium and the large too. A *sibling* does not match, which is
 * exactly the mistake the scope exists to prevent.
 */
export function isAddonOfferedFor(
  scopedProductIds: readonly string[],
  line: { product_id: string | null; parent_id: string | null },
): boolean {
  if (scopedProductIds.length === 0) return true;

  const candidates = [line.product_id, line.parent_id].filter(
    (value): value is string => Boolean(value),
  );

  return candidates.some((id) => scopedProductIds.includes(id));
}

/** The scope of every extra, keyed by add-on id. */
export function addonScopeByAddon(
  rows: readonly Pick<AddonProduct, "addon_id" | "product_id">[],
): Map<string, string[]> {
  const scope = new Map<string, string[]>();

  for (const row of rows) {
    const ids = scope.get(row.addon_id);
    if (ids) ids.push(row.product_id);
    else scope.set(row.addon_id, [row.product_id]);
  }

  return scope;
}

/** The extras on offer for one line: active, and scoped to cover its product. */
export function addonsForLine(
  addons: readonly Addon[],
  scope: Map<string, string[]>,
  line: { product_id: string | null; parent_id: string | null },
): Addon[] {
  return addons.filter(
    (addon) =>
      addon.status === "active" &&
      isAddonOfferedFor(scope.get(addon.id) ?? [], line),
  );
}

// -----------------------------------------------------------------------------
// The catalogue form
// -----------------------------------------------------------------------------
/** An extra, as the catalogue form submits it. */
export type AddonDraft = {
  name: string;
  handle: string;
  description: string | null;
  price_cents: number;
  price_kind: AddonPriceKind;
  max_quantity: number;
  track_stock: boolean;
  quantity_on_hand: number;
  status: AddonStatus;
};

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads and validates a catalogue row.
 *
 * The handle falls back to the current one, then to a slug of the name: an edit
 * whose address field was cleared keeps the address it had, so a URL somebody
 * bookmarked keeps working.
 */
export function parseAddonDraft(
  formData: FormData,
): { draft: AddonDraft } | { error: string } {
  const name = field(formData, "name");
  const nameProblem = addonNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  const handle =
    field(formData, "handle") ||
    field(formData, "current_handle") ||
    deriveAddonHandle(name);
  const handleProblem = addonHandleProblem(handle);
  if (handleProblem) {
    return { error: handleProblem };
  }

  const priceRaw = field(formData, "price");
  const priceCents = priceRaw === "" ? 0 : parsePriceCents(priceRaw);
  if (priceCents === null) {
    return { error: "Enter a price like 12.50." };
  }

  const kind = field(formData, "price_kind") || "per_booking";
  if (!isAddonPriceKind(kind)) {
    return {
      error: "Choose whether the extra is charged per booking or per day.",
    };
  }

  const maxQuantity = Number.parseInt(
    field(formData, "max_quantity") || "1",
    10,
  );
  const quantityProblem = addonQuantityProblem(maxQuantity, MAX_ADDON_QUANTITY);
  if (quantityProblem) {
    return { error: quantityProblem };
  }

  const status = field(formData, "status") || "active";
  if (!isAddonStatus(status)) {
    return { error: "Choose whether the extra is on offer or archived." };
  }

  // A checkbox posts its value only when ticked, so "anything present" is the
  // truth: the form sends `track_stock=on` or nothing at all.
  const trackStock = field(formData, "track_stock") !== "";
  const quantityOnHand = Number.parseInt(
    field(formData, "quantity_on_hand") || "0",
    10,
  );
  const stockProblem = addonStockProblem(trackStock, quantityOnHand);
  if (stockProblem) {
    return { error: stockProblem };
  }

  return {
    draft: {
      name,
      handle,
      description: field(formData, "description") || null,
      price_cents: priceCents,
      price_kind: kind,
      max_quantity: maxQuantity,
      track_stock: trackStock,
      quantity_on_hand: quantityOnHand,
      status,
    },
  };
}
