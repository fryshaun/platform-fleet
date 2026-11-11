import { formatPlanPrice } from "@/lib/plans";
import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import type {
  ProductKind,
  ProductMediaKind,
  ProductStatus,
  Tables,
} from "@/lib/supabase/types";

/**
 * Product rules shared by the section's pages, its Server Actions and its
 * tests.
 *
 * Like `lib/roles.ts` and `lib/plans.ts` this module is free of `server-only`
 * and of any database import: the forms are rendered on the server but a few of
 * them (the gallery uploader) are Client Components, and both sides must agree
 * on what a valid handle, price or date range is. Authorization is *not* here —
 * it is in the Server Actions and in RLS.
 */

export type Product = Tables<"products">;
export type ProductCategory = Tables<"product_categories">;
export type ProductDate = Tables<"product_dates">;
export type ProductMedia = Tables<"product_media">;

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------
export const PRODUCT_STATUSES = [
  "draft",
  "active",
  "archived",
] as const satisfies readonly ProductStatus[];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const PRODUCT_STATUS_OPTIONS = PRODUCT_STATUSES.map((status) => ({
  value: status,
  label: PRODUCT_STATUS_LABELS[status],
}));

export function isProductStatus(value: unknown): value is ProductStatus {
  return (
    typeof value === "string" &&
    (PRODUCT_STATUSES as readonly string[]).includes(value)
  );
}

export const PRODUCT_KINDS = [
  "item",
  "dated",
] as const satisfies readonly ProductKind[];

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  item: "Single stock count",
  dated: "Date-based inventory",
};

export const PRODUCT_KIND_OPTIONS = PRODUCT_KINDS.map((kind) => ({
  value: kind,
  label: PRODUCT_KIND_LABELS[kind],
  description:
    kind === "item"
      ? "One stock number for the whole product."
      : "Stock is counted per window — one row per date range.",
}));

export function isProductKind(value: unknown): value is ProductKind {
  return (
    typeof value === "string" &&
    (PRODUCT_KINDS as readonly string[]).includes(value)
  );
}

/** Currencies the money input offers. The column accepts any ISO-4217 code. */
export const PRODUCT_CURRENCIES = [
  "usd",
  "eur",
  "gbp",
  "cad",
  "aud",
  "nzd",
] as const;

export type ProductCurrency = (typeof PRODUCT_CURRENCIES)[number];

export const PRODUCT_CURRENCY_OPTIONS = PRODUCT_CURRENCIES.map((code) => ({
  value: code,
  label: code.toUpperCase(),
}));

export function isProductCurrency(value: unknown): value is ProductCurrency {
  return (
    typeof value === "string" &&
    (PRODUCT_CURRENCIES as readonly string[]).includes(value)
  );
}

// -----------------------------------------------------------------------------
// Handles
// -----------------------------------------------------------------------------
/**
 * Segments `/products/<handle>` already uses for its own pages, so no product
 * may claim them. Mirrors the route folder names under
 * `app/[tenant]/products/`.
 */
export const RESERVED_PRODUCT_HANDLES = new Set(["new", "categories"]);

function handleProblem(handle: string, noun: string): string | null {
  if (handle.length === 0) {
    return `Enter ${noun} address.`;
  }

  const problem = validateSlug(handle);
  return problem ? SLUG_PROBLEM_MESSAGES[problem] : null;
}

/** Explains what is wrong with a product handle, or `null` when it is usable. */
export function productHandleProblem(handle: string): string | null {
  if (RESERVED_PRODUCT_HANDLES.has(handle)) {
    return "That address is reserved by the section. Please pick another.";
  }

  return handleProblem(handle, "a product");
}

/** Explains what is wrong with a category handle, or `null` when it is usable. */
export function categoryHandleProblem(handle: string): string | null {
  return handleProblem(handle, "a category");
}

/** Turns a title (and an optional suffix) into a handle. */
export function deriveHandle(...parts: string[]): string {
  return slugify(parts.filter(Boolean).join(" "));
}

/**
 * The DOM id of the "new product" panel's form.
 *
 * The panel keeps its submit button in a footer *outside* the `<form>` — that is
 * what lets Cancel and Create product sit side by side in the footer — so the
 * button and the form have to agree on this string. It lives here, away from
 * both, so neither side can drift without the other noticing.
 */
export const NEW_PRODUCT_FORM_ID = "product-new-form";

/**
 * The same contract for the categories index, whose panel is filled in by
 * `CategoryFields` and submitted by `FormSheet`'s footer button.
 */
export const NEW_CATEGORY_FORM_ID = "category-new-form";

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------
/** Seven digits of major units keeps `price_cents` inside a Postgres integer. */
const PRICE_PATTERN = /^\d{1,7}(?:\.\d{1,2})?$/;

/**
 * Parses a money input ("12.34") into minor units, or `null` when the text is
 * not an amount this app can store.
 */
export function parsePriceCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!PRICE_PATTERN.test(trimmed)) return null;

  return Math.round(Number.parseFloat(trimmed) * 100);
}

/** The value a money input should show for a stored amount. */
export function priceInputValue(priceCents: number | null): string {
  return priceCents === null ? "" : (priceCents / 100).toFixed(2);
}

/**
 * Formats a stored amount the same way the plan picker formats Stripe prices:
 * both come from `formatPlanPrice`, so the shop and the billing page cannot
 * disagree about currency or decimals.
 */
export function formatPriceCents(priceCents: number, currency: string): string {
  return formatPlanPrice({ unitAmount: priceCents, currency });
}

export function formatProductPrice(
  product: Pick<Product, "price_cents" | "currency">,
): string {
  return formatPriceCents(product.price_cents, product.currency);
}

// -----------------------------------------------------------------------------
// Stock
// -----------------------------------------------------------------------------
/** A counted item at or below this number reads as "running low". */
export const LOW_STOCK_THRESHOLD = 5;

type StockSubject = Pick<
  Product,
  "kind" | "track_inventory" | "inventory_quantity"
>;

/** One line for the product list: what this row's stock means. */
export function inventoryLabel(product: StockSubject): string {
  if (product.kind === "dated") return "Stocked per date";
  if (!product.track_inventory) return "Not tracked";
  if (product.inventory_quantity === null) return "Not counted";
  if (product.inventory_quantity === 0) return "Out of stock";

  return `${product.inventory_quantity} in stock`;
}

/** True for a counted item that is out of stock or nearly so. */
export function isLowStock(product: StockSubject): boolean {
  return (
    product.kind === "item" &&
    product.track_inventory &&
    product.inventory_quantity !== null &&
    product.inventory_quantity <= LOW_STOCK_THRESHOLD
  );
}

// -----------------------------------------------------------------------------
// Variants
// -----------------------------------------------------------------------------
export type ProductFamily = {
  parent: Product;
  variants: Product[];
};

/**
 * Splits a flat product list into parents and their variants.
 *
 * Variants carry their own price, SKU, stock and gallery, so they are ordinary
 * `products` rows; this only groups them for display. A variant whose parent is
 * missing from `products` is dropped — every caller either passes a list that
 * contains the parents or filters on `parent_id` itself.
 */
export function groupVariants(
  products: readonly Product[],
): ProductFamily[] {
  const variantsByParent = new Map<string, Product[]>();

  for (const product of products) {
    if (!product.parent_id) continue;

    const siblings = variantsByParent.get(product.parent_id) ?? [];
    siblings.push(product);
    variantsByParent.set(product.parent_id, siblings);
  }

  return products
    .filter((product) => product.parent_id === null)
    .map((parent) => ({
      parent,
      variants: variantsByParent.get(parent.id) ?? [],
    }));
}

/** The cheapest price a family can be bought for, used by the list. */
export function familyPriceLabel(family: ProductFamily): string {
  const prices = [family.parent, ...family.variants].map(
    (product) => product.price_cents,
  );
  const lowest = Math.min(...prices);

  return family.variants.length > 0 && lowest !== family.parent.price_cents
    ? `From ${formatPriceCents(lowest, family.parent.currency)}`
    : formatPriceCents(family.parent.price_cents, family.parent.currency);
}

// -----------------------------------------------------------------------------
// Reading order
// -----------------------------------------------------------------------------
/**
 * The orders the catalogue index can be read in.
 *
 * `title` is the default and the order the catalogue has always been listed in.
 * The price orders compare the parent rows only — a family's "from" price is
 * derived after grouping — so they read as "the shelf, cheapest first" rather
 * than as a strict sort of every variant.
 */
export const PRODUCT_SORT_OPTIONS = [
  { value: "title", label: "Name A–Z" },
  { value: "title-desc", label: "Name Z–A" },
  { value: "newest", label: "Newest first" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
] as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number]["value"];

/**
 * The `?sort=` to use, falling back to `title`.
 *
 * Anything unknown — a hand-typed URL, a stale bookmark — reads as the default
 * rather than as an error, the same way an unknown `?status=` is ignored.
 */
export function readProductSort(value: unknown): ProductSort {
  return (
    PRODUCT_SORT_OPTIONS.find((option) => option.value === value)?.value ??
    "title"
  );
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------
/**
 * The orders the categories index can be read in.
 *
 * `position` is the shelf order the section has always used — the number the
 * operator types, then the name to break ties. `busiest` is the odd one out:
 * category sizes are counted in the page (PostgREST cannot `group by` without
 * an RPC), so that order is applied once the rows arrive instead of in SQL.
 */
export const CATEGORY_SORT_OPTIONS = [
  { value: "position", label: "Shelf order" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "busiest", label: "Most products" },
] as const;

export type CategorySort = (typeof CATEGORY_SORT_OPTIONS)[number]["value"];

/** The `?sort=` to use, falling back to the shelf order. */
export function readCategorySort(value: unknown): CategorySort {
  return (
    CATEGORY_SORT_OPTIONS.find((option) => option.value === value)?.value ??
    "position"
  );
}

/** Characters PostgREST reads as filter syntax, or `ilike` as wildcards. */
const CATEGORY_SEARCH_STRIP = /[,()%*\\]/g;

/**
 * The `?q=` to search categories for, or `null` when there is nothing to search.
 *
 * The result is spliced into PostgREST's `or()` filter, so the characters that
 * would end one predicate or start another are dropped rather than escaped: a
 * search box is a substring match, not a pattern language. Whitespace is
 * collapsed, and a term made only of those characters reads as "no search"
 * rather than as "match everything".
 */
export function categorySearchTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const term = value
    .replace(CATEGORY_SEARCH_STRIP, " ")
    .replace(/\s+/g, " ")
    .trim();

  return term.length > 0 ? term : null;
}

// -----------------------------------------------------------------------------
// Date-based inventory
// -----------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

/**
 * Validates a booking window. `starts_on`/`ends_on` are `date` columns, so the
 * comparison is on `YYYY-MM-DD` strings: they sort chronologically as text.
 */
export function dateRangeProblem(startsOn: string, endsOn: string): string | null {
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) {
    return "Choose a start and an end date.";
  }
  if (endsOn < startsOn) {
    return "The end date must be on or after the start date.";
  }
  return null;
}

/** "Mar 4, 2026", or "Mar 4 – Mar 8, 2026" for a window. */
export function formatDateRange(startsOn: string, endsOn: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      // `date` columns carry no zone; reading them as UTC keeps the day the
      // operator typed, wherever the server happens to run.
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));

  const start = format(startsOn);
  return endsOn === startsOn ? start : `${start} – ${format(endsOn)}`;
}

// -----------------------------------------------------------------------------
// Gallery media
// -----------------------------------------------------------------------------
/** The Storage bucket every gallery object lives in. */
export const PRODUCT_MEDIA_BUCKET = "product-media";

/** Mirrors `file_size_limit` on the bucket. */
export const PRODUCT_MEDIA_MAX_BYTES = 52_428_800;

export type ProductMediaType = {
  mime: string;
  extension: string;
  kind: ProductMediaKind;
};

/** Mirrors `allowed_mime_types` on the bucket. */
export const PRODUCT_MEDIA_TYPES: readonly ProductMediaType[] = [
  { mime: "image/png", extension: "png", kind: "image" },
  { mime: "image/jpeg", extension: "jpg", kind: "image" },
  { mime: "image/webp", extension: "webp", kind: "image" },
  { mime: "image/avif", extension: "avif", kind: "image" },
  { mime: "video/mp4", extension: "mp4", kind: "video" },
  { mime: "video/webm", extension: "webm", kind: "video" },
];

/** The `accept` attribute of the upload input. */
export const PRODUCT_MEDIA_ACCEPT = PRODUCT_MEDIA_TYPES.map(
  (type) => type.mime,
).join(",");

export function mediaTypeFor(mime: string): ProductMediaType | null {
  return PRODUCT_MEDIA_TYPES.find((type) => type.mime === mime) ?? null;
}

/**
 * `<company>/<product>/<file>` — the layout the storage policies in migration 03
 * parse to decide who may write. Building it anywhere else would drift from
 * them.
 */
export function productMediaPath(
  companyId: string,
  productId: string,
  file: string,
): string {
  return `${companyId}/${productId}/${file}`;
}

