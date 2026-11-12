import { formatDateRange, isIsoDate } from "@/lib/products";
import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import type { Tables } from "@/lib/supabase/types";

/**
 * Component rules shared by the fleet pages, the Server Actions and the tests.
 *
 * Like `lib/assets.ts` this module is free of `server-only` and of any database
 * import. Authorization is in the Server Actions and in RLS.
 *
 * The three rules worth stating once:
 *
 *   1. A component is *fitted* while `removed_on` is null. Removing it sets a
 *      date and keeps the row — the service history is the reason it exists.
 *   2. The fitted window is half-open, `[fitted_on, removed_on)`, like every
 *      other window in this schema.
 *   3. One unit may hold one component of a kind at a time. The database states
 *      it as a partial unique index, so two forks on one bike is impossible even
 *      if two people type at once.
 */

export type ComponentKind = Tables<"component_kinds">;
export type AssetComponent = Tables<"asset_components">;

// -----------------------------------------------------------------------------
// Kinds
// -----------------------------------------------------------------------------
export const RESERVED_KIND_HANDLES = new Set(["new"]);

/** Explains what is wrong with a kind's handle, or `null` when it is usable. */
export function kindHandleProblem(handle: string): string | null {
  if (RESERVED_KIND_HANDLES.has(handle)) {
    return "That address is reserved by the section. Please pick another.";
  }
  if (handle.length === 0) {
    return "Enter an address for the kind.";
  }

  const problem = validateSlug(handle);
  return problem ? SLUG_PROBLEM_MESSAGES[problem] : null;
}

/** Turns a kind's name into a handle, the same way a category's is derived. */
export function deriveKindHandle(name: string): string {
  return slugify(name);
}

/** Mirrors `length(trim(name)) between 1 and 80` in the database. */
export function kindNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the kind a name, for example Fork.";
  if (trimmed.length > 80) return "Keep the name under 80 characters.";
  return null;
}

// -----------------------------------------------------------------------------
// Service intervals
// -----------------------------------------------------------------------------
/**
 * The three ways a workshop measures a service interval.
 *
 * A kind may carry all three, some, or none: a chain wears by distance, a fork
 * damper by hours ridden, brake fluid by the calendar. Keeping the number on the
 * *kind* rather than on each part is what lets one interval apply to every fork
 * in the fleet.
 */
export const SERVICE_INTERVAL_UNITS = ["days", "km", "hours"] as const;

export type ServiceIntervalUnit = (typeof SERVICE_INTERVAL_UNITS)[number];

/**
 * How each interval is asked for on the form.
 *
 * The labels, the hints and the step are here rather than in the JSX so the
 * three inputs are rendered from one list and cannot drift from the units the
 * parser accepts.
 */
export const SERVICE_INTERVAL_FIELDS: Record<
  ServiceIntervalUnit,
  { label: string; placeholder: string; step: string; hint: string }
> = {
  days: {
    label: "Every … days",
    placeholder: "90",
    step: "1",
    hint: "Calendar work — brake fluid, bearings, an annual check.",
  },
  km: {
    label: "Every … km",
    placeholder: "200",
    step: "0.01",
    hint: "Distance work — tyres, chains, pads, from the unit's usage log.",
  },
  hours: {
    label: "Every … hours",
    placeholder: "50",
    step: "0.01",
    hint: "Riding hours — fork and shock service.",
  },
};

/** The form field a unit's interval is posted as, and the column it lands in. */
export function intervalFieldName(
  unit: ServiceIntervalUnit,
): `interval_${ServiceIntervalUnit}` {
  return `interval_${unit}`;
}

/**
 * Friendly ceilings, deliberately inside the columns (`integer`, `numeric(10,2)`,
 * `numeric(8,2)`) rather than at their edge: a typo that lands on 999999 hours
 * should be a sentence, not a Postgres error.
 */
const INTERVAL_LIMITS: Record<ServiceIntervalUnit, number> = {
  days: 3650,
  km: 200_000,
  hours: 100_000,
};

/**
 * Reads one interval off the form.
 *
 * Empty and `0` mean the same thing — "not measured this way". Migration 22
 * coalesces the columns to 0 in the view, so the two behave identically there;
 * storing `null` keeps that from turning into two spellings of one state in the
 * table. Days must be whole (the column is an `integer`); the other two take up
 * to two decimals.
 */
export function parseIntervalValue(
  raw: string,
  unit: ServiceIntervalUnit,
): { value: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };

  const pattern = unit === "days" ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) {
    return {
      error:
        unit === "days"
          ? "Days between services is a whole number."
          : `Use a number with at most two decimals for the ${unit} interval.`,
    };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return { error: "An interval cannot be negative." };
  }
  if (value === 0) return { value: null };
  if (value > INTERVAL_LIMITS[unit]) {
    return {
      error: `Keep the ${unit} interval under ${INTERVAL_LIMITS[
        unit
      ].toLocaleString("en-US")}.`,
    };
  }

  return { value };
}

/** The value an interval input should show for a stored amount. */
export function intervalInputValue(value: number | null): string {
  if (value === null) return "";
  // PostgREST hands a `numeric` back as a number for these sizes, but a string
  // costs nothing to accept and a stray "200.00" in an input looks like a bug.
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

/**
 * "every 90 days · every 200 km", or "No interval set".
 *
 * A zero interval reads as absent: an older row may hold 0, the view treats that
 * as "not measured", and the label must agree with the arithmetic.
 */
export function describeInterval(
  kind: Pick<ComponentKind, "interval_days" | "interval_km" | "interval_hours">,
): string {
  const days = Number(kind.interval_days ?? 0);
  const km = Number(kind.interval_km ?? 0);
  const hours = Number(kind.interval_hours ?? 0);
  const parts: string[] = [];

  if (days > 0) parts.push(`every ${days} ${days === 1 ? "day" : "days"}`);
  if (km > 0) parts.push(`every ${String(km)} km`);
  if (hours > 0) {
    parts.push(`every ${String(hours)} ${hours === 1 ? "hour" : "hours"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "No interval set";
}

/** A kind, as the taxonomy form submits it. */
export type ComponentKindDraft = {
  name: string;
  handle: string;
  position: number;
  interval_days: number | null;
  interval_km: number | null;
  interval_hours: number | null;
};

/** The id of the "new kind" `<form>`, so the panel's footer button can submit it. */
export const NEW_KIND_FORM_ID = "kind-new-form";

/** The id of the "fit a part" `<form>` on a unit's Components tab. */
export const NEW_COMPONENT_FORM_ID = "component-new-form";

/** Reads and validates a taxonomy row. */
export function parseComponentKindDraft(
  formData: FormData,
): { draft: ComponentKindDraft } | { error: string } {
  const name = field(formData, "name");
  const nameProblem = kindNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  const handle =
    field(formData, "handle") ||
    field(formData, "current_handle") ||
    deriveKindHandle(name);
  const handleProblem = kindHandleProblem(handle);
  if (handleProblem) {
    return { error: handleProblem };
  }

  const position = Number.parseInt(field(formData, "position") || "0", 10);
  if (!Number.isInteger(position) || position < 0) {
    return { error: "Order is a whole number, 0 or more." };
  }

  const days = parseIntervalValue(field(formData, "interval_days"), "days");
  if ("error" in days) return { error: days.error };
  const km = parseIntervalValue(field(formData, "interval_km"), "km");
  if ("error" in km) return { error: km.error };
  const hours = parseIntervalValue(field(formData, "interval_hours"), "hours");
  if ("error" in hours) return { error: hours.error };

  return {
    draft: {
      name,
      handle,
      position,
      interval_days: days.value,
      interval_km: km.value,
      interval_hours: hours.value,
    },
  };
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------
/** Mirrors `length(trim(name)) between 1 and 120` in the database. */
export function componentNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Give the component a name, for example Fox 36.";
  }
  if (trimmed.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/** Mirrors the serial-length CHECK; an absent serial is fine. */
export function componentSerialProblem(serial: string): string | null {
  if (serial.trim().length > 120) {
    return "Keep the serial number under 120 characters.";
  }
  return null;
}

/**
 * Explains what is wrong with a fitted window, or `null`.
 *
 * Half-open: a part fitted and removed on the same day was never fitted, so
 * `removed_on` must be strictly later. An empty `removed_on` means "still
 * fitted" and is always legal.
 */
export function fittedWindowProblem(
  fittedOn: string,
  removedOn: string,
): string | null {
  if (!isIsoDate(fittedOn)) {
    return "Choose the day the part was fitted.";
  }
  if (removedOn === "") return null;
  if (!isIsoDate(removedOn)) {
    return "Choose the day the part came off, or leave it blank.";
  }
  if (removedOn <= fittedOn) {
    return "A part cannot come off on or before the day it was fitted.";
  }
  return null;
}

/** True while the component is fitted to a unit. */
export function isFitted(
  component: Pick<AssetComponent, "asset_id" | "removed_on">,
): boolean {
  return component.asset_id !== null && component.removed_on === null;
}

/** Where a component is, in the words the page uses. */
export function componentWhereLabel(
  component: Pick<AssetComponent, "asset_id" | "removed_on">,
  assetName: string | undefined,
): string {
  if (component.removed_on !== null) return "Removed";
  if (component.asset_id === null) return "In the parts bin";
  return `Fitted to ${assetName ?? "a unit"}`;
}

/**
 * The fitted window in words: "Mar 4, 2026" while the part is on, and
 * "Mar 4 – Mar 8, 2026" once it came off.
 *
 * Both columns are `date`, so the range helper reads them in UTC and the day the
 * operator typed never moves with the server's zone.
 */
export function fittedWindowLabel(
  component: Pick<AssetComponent, "fitted_on" | "removed_on">,
): string {
  return formatDateRange(
    component.fitted_on,
    component.removed_on ?? component.fitted_on,
  );
}

/** The components on one unit, fitted ones first, newest fitting first. */
export function componentsForAsset(
  components: readonly AssetComponent[],
  assetId: string,
): AssetComponent[] {
  return components
    .filter((component) => component.asset_id === assetId)
    .sort((a, b) => {
      if (isFitted(a) !== isFitted(b)) return isFitted(a) ? -1 : 1;
      return b.fitted_on.localeCompare(a.fitted_on);
    });
}

/** A component, as the form submits it. */
export type ComponentDraft = {
  name: string;
  serial: string | null;
  kind_id: string | null;
  asset_id: string | null;
  fitted_on: string;
  removed_on: string | null;
  notes: string | null;
};

/** Reads and validates a component. */
export function parseComponentDraft(
  formData: FormData,
): { draft: ComponentDraft } | { error: string } {
  const name = field(formData, "name");
  const nameProblem = componentNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  const serial = field(formData, "serial");
  const serialProblem = componentSerialProblem(serial);
  if (serialProblem) {
    return { error: serialProblem };
  }

  const fittedOn = field(formData, "fitted_on");
  const removedOn = field(formData, "removed_on");
  const windowProblem = fittedWindowProblem(fittedOn, removedOn);
  if (windowProblem) {
    return { error: windowProblem };
  }

  return {
    draft: {
      name,
      serial: serial || null,
      kind_id: field(formData, "kind_id") || null,
      asset_id: field(formData, "asset_id") || null,
      fitted_on: fittedOn,
      removed_on: removedOn || null,
      notes: field(formData, "notes") || null,
    },
  };
}

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
