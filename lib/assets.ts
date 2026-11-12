import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import type { AssetStatus, Tables } from "@/lib/supabase/types";

/**
 * Asset rules shared by the section's pages, its Server Actions and its tests.
 *
 * Like `lib/products.ts` this module is free of `server-only` and of any
 * database import, so a Server Component and a Client Component can agree on
 * what a valid handle, name or serial is. Authorization is *not* here — it is in
 * the Server Actions and in RLS.
 */

export type Asset = Tables<"assets">;

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------
export const ASSET_STATUSES = [
  "available",
  "in_workshop",
  "retired",
  "rented",
] as const satisfies readonly AssetStatus[];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: "Available",
  in_workshop: "In the workshop",
  retired: "Retired",
  rented: "Out on hire",
};

/**
 * The statuses a person may set.
 *
 * `rented` is absent on purpose: it is written by `refresh_asset_rented()` from
 * today's bookings, and a form that could set it would let a unit be marked out
 * when nothing is holding it. The action refuses it and the page does not offer
 * it, so the two can never disagree.
 */
export const ASSET_SETTABLE_STATUSES = [
  "available",
  "in_workshop",
  "retired",
] as const satisfies readonly AssetStatus[];

export const ASSET_STATUS_OPTIONS = ASSET_SETTABLE_STATUSES.map((status) => ({
  value: status,
  label: ASSET_STATUS_LABELS[status],
  description:
    status === "available"
      ? "In service, and can be booked."
      : status === "in_workshop"
        ? "Still in the fleet, but out of action while it is being fixed."
        : "Has left the fleet. Kept so its history stays readable.",
}));

export function isAssetStatus(value: unknown): value is AssetStatus {
  return (
    typeof value === "string" &&
    (ASSET_STATUSES as readonly string[]).includes(value)
  );
}

/** True when a person may move a unit into this status. */
export function isSettableAssetStatus(
  value: unknown,
): value is (typeof ASSET_SETTABLE_STATUSES)[number] {
  return (
    typeof value === "string" &&
    (ASSET_SETTABLE_STATUSES as readonly string[]).includes(value)
  );
}

// -----------------------------------------------------------------------------
// Reading order
// -----------------------------------------------------------------------------
/**
 * The orders the fleet index can be read in.
 *
 * `name` is the default and the order the fleet has always been listed in.
 * `status` groups the units a shopkeeper scans for first — available, then out
 * of action, then retired — because PostgreSQL orders an enum by the way it was
 * declared in the migration. `newest` reads the rows in the order they were
 * added, which is how someone checking their own work wants them.
 */
export const ASSET_SORT_OPTIONS = [
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "newest", label: "Newest first" },
  { value: "status", label: "Status" },
] as const;

export type AssetSort = (typeof ASSET_SORT_OPTIONS)[number]["value"];

/**
 * The `?sort=` to use, falling back to `name`.
 *
 * Anything unknown — a hand-typed URL, a stale bookmark — reads as the default
 * rather than as an error, the same way an unknown `?status=` is ignored.
 */
export function readAssetSort(value: unknown): AssetSort {
  return (
    ASSET_SORT_OPTIONS.find((option) => option.value === value)?.value ?? "name"
  );
}

// -----------------------------------------------------------------------------
// Handles, names and serials
// -----------------------------------------------------------------------------
/**
 * Segments `/assets/<handle>` already uses for its own pages, so no asset may
 * claim them. Mirrors the route folder names under `app/[tenant]/assets/`.
 */
export const RESERVED_ASSET_HANDLES = new Set(["new", "kinds"]);

/** Explains what is wrong with an asset handle, or `null` when it is usable. */
export function assetHandleProblem(handle: string): string | null {
  if (RESERVED_ASSET_HANDLES.has(handle)) {
    return "That address is reserved by the section. Please pick another.";
  }
  if (handle.length === 0) {
    return "Enter an asset address.";
  }

  const problem = validateSlug(handle);
  return problem ? SLUG_PROBLEM_MESSAGES[problem] : null;
}

/**
 * Turns a name (and an optional suffix) into a handle.
 *
 * Units are numbered — "bike-1", "bike-2" — so callers pass the number as a
 * second part and get a handle that sorts the way staff read the fleet.
 */
export function deriveAssetHandle(...parts: string[]): string {
  return slugify(parts.filter(Boolean).join(" "));
}

/** Mirrors `length(trim(name)) between 1 and 80` in the database. */
export function assetNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the unit a name, for example bike-1.";
  if (trimmed.length > 80) return "Keep the name under 80 characters.";
  return null;
}

/** Mirrors `length(trim(serial)) between 1 and 120` in the database. */
export function serialProblem(serial: string): string | null {
  if (serial.trim().length > 120) {
    return "Keep the serial number under 120 characters.";
  }
  return null;
}

/**
 * The DOM id of the "new asset" panel's form.
 *
 * The panel keeps its submit button in a footer *outside* the `<form>` — that is
 * what lets Cancel and Add asset sit side by side in the footer — so the button
 * and the form have to agree on this string. It lives here, away from both, so
 * neither side can drift without the other noticing.
 */
export const NEW_ASSET_FORM_ID = "asset-new-form";

// -----------------------------------------------------------------------------
// Availability
// -----------------------------------------------------------------------------
/**
 * Whether a unit may be promised to a customer.
 *
 * Availability is *derived* from the rows: nothing anywhere stores a count. That
 * is the whole point of the section — marking bike-2 out of action on Monday
 * lowers what the shop can offer without anybody editing a stock number.
 */
export function isAssetAvailable(asset: Pick<Asset, "status">): boolean {
  return asset.status === "available";
}

export type AssetSummary = {
  total: number;
  available: number;
  outOfService: number;
  outOnHire: number;
  retired: number;
};

/**
 * Counts a set of units.
 *
 * Every branch is spelled out rather than ending in `else`: the `else` this
 * replaces silently counted any status it had not heard of as retired, which is
 * exactly what `rented` would have become. A missing `else` is a compile error
 * here, because `AssetStatus` is a closed union.
 */
export function summariseAssets(
  assets: readonly Pick<Asset, "status">[],
): AssetSummary {
  let available = 0;
  let outOfService = 0;
  let outOnHire = 0;
  let retired = 0;

  for (const asset of assets) {
    if (asset.status === "available") available += 1;
    else if (asset.status === "in_workshop") outOfService += 1;
    else if (asset.status === "rented") outOnHire += 1;
    else if (asset.status === "retired") retired += 1;
  }

  return {
    total: assets.length,
    available,
    outOfService,
    outOnHire,
    retired,
  };
}

/**
 * "2 of 3 available" — the figure the shop actually needs. Units that have left
 * the fleet are already excluded from `total`, so the sentence never counts a
 * retired bike as something that could have been booked.
 */
export function availabilityLabel(assets: readonly Pick<Asset, "status">[]): string {
  const { total, available } = summariseAssets(assets);
  if (total === 0) return "No units yet";
  if (available === total) return `All ${total} available`;
  if (available === 0) return `None of ${total} available`;
  return `${available} of ${total} available`;
}

/** The units that fulfil one product row, newest last. */
export function assetsForProduct(
  assets: readonly Asset[],
  productId: string,
): Asset[] {
  return assets.filter((asset) => asset.product_id === productId);
}

/** Groups the fleet by the product it fulfils; units with no product are under `null`. */
export function assetsByProduct(assets: readonly Asset[]): Map<string, Asset[]> {
  const groups = new Map<string, Asset[]>();

  for (const asset of assets) {
    const key = asset.product_id ?? "";
    const group = groups.get(key);
    if (group) group.push(asset);
    else groups.set(key, [asset]);
  }

  return groups;
}

/** The label a status pill shows, kept next to the rules that use it. */
export function assetStatusLabel(status: AssetStatus): string {
  return ASSET_STATUS_LABELS[status];
}

/**
 * When a unit last changed status, as "Mar 4, 2026, 9:31 AM".
 *
 * Formatted in UTC for the same reason `formatDateRange` reads dates that way:
 * the sentence must not move because the server happens to run elsewhere.
 */
export function formatStatusChanged(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

