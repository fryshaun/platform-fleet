import { formatDateRange, isIsoDate } from "@/lib/products";
import type { Tables } from "@/lib/supabase/types";

/**
 * Usage rules shared by the unit's Usage tab, the Server Actions and the tests.
 *
 * Readings are **incremental** (migration 21): `hours` and `distance_km` are what
 * happened since the previous reading, not a cumulative odometer. Nothing stores
 * a total — the sum is computed when it is read — which is why every helper here
 * takes the rows and returns a number rather than reading a column.
 *
 * The same numbers feed the service intervals: a component's usage is its unit's
 * readings inside the fitted window, so a typo here moves a service date there.
 * That is why deleting a reading is manager work and adding one is not.
 */

export type UsageLog = Tables<"asset_usage_logs">;

/** A reading, as the form submits it. */
export type UsageDraft = {
  logged_on: string;
  hours: number;
  distance_km: number;
  notes: string | null;
};

/** The id of the "log a reading" `<form>`, so the panel's footer button can submit it. */
export const NEW_USAGE_FORM_ID = "usage-new-form";

/** Columns that carry `numeric(_, 2)`: at most two decimals. */
const DECIMALS = /^\d+(?:\.\d{1,2})?$/;

/**
 * Friendly ceilings, inside the columns (`numeric(8,2)`, `numeric(10,2)`) rather
 * than at their edge.
 *
 * Deliberately generous: a reading covers *everything since the last one*, so a
 * bike hired out for a fortnight can honestly log hundreds of hours, and refusing
 * that would push the desk into inventing readings.
 */
const MAX_HOURS = 10_000;
const MAX_DISTANCE_KM = 100_000;

/**
 * Reads one amount off the form.
 *
 * Empty means zero — a ride that covered no distance still logged its hours —
 * and the database states the same thing with `default 0`.
 */
function readAmount(
  raw: string,
  { label, max }: { label: string; max: number },
): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: 0 };

  if (!DECIMALS.test(trimmed)) {
    return { error: `${label} is a number, to two decimals at most.` };
  }

  const value = Number(trimmed);
  if (value > max) {
    return { error: `That is more ${label.toLowerCase()} than one entry should hold — check the reading.` };
  }

  return { value };
}

/**
 * Reads and validates a reading.
 *
 * The "something happened" rule mirrors `asset_usage_logs_reading`
 * (`hours > 0 or distance_km > 0`): a row that says nothing is not a reading, and
 * it would still count as a reading in every total.
 */
export function parseUsageDraft(
  formData: FormData,
): { draft: UsageDraft } | { error: string } {
  const loggedOn = field(formData, "logged_on");
  if (!isIsoDate(loggedOn)) {
    return { error: "Choose the day the use happened." };
  }

  const hours = readAmount(field(formData, "hours"), {
    label: "Hours",
    max: MAX_HOURS,
  });
  if ("error" in hours) return { error: hours.error };

  const distance = readAmount(field(formData, "distance_km"), {
    label: "Kilometres",
    max: MAX_DISTANCE_KM,
  });
  if ("error" in distance) return { error: distance.error };

  if (hours.value === 0 && distance.value === 0) {
    return { error: "A reading needs hours, kilometres, or both." };
  }

  return {
    draft: {
      logged_on: loggedOn,
      hours: hours.value,
      distance_km: distance.value,
      notes: field(formData, "notes") || null,
    },
  };
}

/** One unit's readings, newest first — the order the tab reads them in. */
export function usageForAsset(
  logs: readonly UsageLog[],
  assetId: string,
): UsageLog[] {
  return logs
    .filter((log) => log.asset_id === assetId)
    .sort((a, b) => b.logged_on.localeCompare(a.logged_on));
}

export type UsageTotals = {
  readings: number;
  hours: number;
  distanceKm: number;
};

/**
 * The only total there is: the sum of the readings.
 *
 * Rounded to the columns' two decimals, because 0.1 + 0.2 is not 0.3 in binary
 * floating point and a total that reads 12.299999999 must not reach a screen.
 */
export function summariseUsage(logs: readonly UsageLog[]): UsageTotals {
  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    readings: logs.length,
    hours: round(logs.reduce((total, log) => total + Number(log.hours), 0)),
    distanceKm: round(
      logs.reduce((total, log) => total + Number(log.distance_km), 0),
    ),
  };
}

/** `12.5` for "12.5 hours", `12` for "12 hours" — no trailing zeros. */
function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function formatHours(hours: number): string {
  return `${trim(hours)} ${hours === 1 ? "hour" : "hours"}`;
}

export function formatDistance(distanceKm: number): string {
  return `${trim(distanceKm)} km`;
}

/** "Mar 4, 2026" — read in UTC, so the day the operator typed cannot move. */
export function formatLoggedOn(loggedOn: string): string {
  return formatDateRange(loggedOn, loggedOn);
}

/**
 * "3 readings · 12.5 hours · 38 km", leaving out what a unit never logged.
 *
 * A workshop that only books coaching hours has no distance to report, and a
 * line reading "0 km" in every summary would read like a fault.
 */
export function usageSummary(logs: readonly UsageLog[]): string {
  if (logs.length === 0) return "No readings yet.";

  const { readings, hours, distanceKm } = summariseUsage(logs);

  return [
    `${readings} reading${readings === 1 ? "" : "s"}`,
    hours > 0 ? formatHours(hours) : null,
    distanceKm > 0 ? formatDistance(distanceKm) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
