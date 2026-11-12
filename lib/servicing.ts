import { describeInterval } from "@/lib/components";
import { formatDateRange, isIsoDate } from "@/lib/products";
import type { ServiceStatus, Tables, Views } from "@/lib/supabase/types";

/**
 * Service rules shared by the unit's Service tab, the Server Actions and the
 * tests.
 *
 * Nothing here decides whether a part is due — `component_service_status`
 * (migration 22) derives that from the kind's interval, the part's fitted window
 * and the unit's usage readings every time it is read. This module's job is the
 * words: how a status reads, which of the three measures is counting, and how
 * urgent the list is.
 *
 * Two things the view does that the labels must respect:
 *
 *   1. It coalesces the intervals to `0`, so `0` means "not measured this way"
 *      and must never be rendered as "every 0 km".
 *   2. It has no `kind_id` and no `removed_on`, so a row is joined to its part on
 *      `component_id` — the part keeps the kind and the window.
 */

export type ServiceEvent = Tables<"component_service_events">;
export type ComponentServiceStatus = Views<"component_service_status">;

/** A service event, as the form submits it. */
export type ServiceEventDraft = {
  component_id: string;
  serviced_on: string;
  notes: string | null;
};

/** The id of the "record a service" `<form>`, so the panel's footer button can submit it. */
export const NEW_SERVICE_FORM_ID = "service-new-form";

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  ok: "OK",
  due_soon: "Due soon",
  overdue: "Overdue",
};

/** Most urgent first — the order the list is made in. */
export const SERVICE_STATUS_ORDER: readonly ServiceStatus[] = [
  "overdue",
  "due_soon",
  "ok",
];

export function serviceStatusLabel(status: ServiceStatus): string {
  return SERVICE_STATUS_LABELS[status];
}

/** 0 for overdue, 1 for due soon, 2 for ok; unknown statuses sort last. */
export function serviceStatusRank(status: ServiceStatus): number {
  const index = SERVICE_STATUS_ORDER.indexOf(status);
  return index === -1 ? SERVICE_STATUS_ORDER.length : index;
}

/** Reads and validates a service event. */
export function parseServiceEventDraft(
  formData: FormData,
): { draft: ServiceEventDraft } | { error: string } {
  const componentId = field(formData, "component_id");
  if (!componentId) {
    return { error: "Choose the part that was serviced." };
  }

  const servicedOn = field(formData, "serviced_on");
  if (!isIsoDate(servicedOn)) {
    return { error: "Choose the day the service happened." };
  }

  return {
    draft: {
      component_id: componentId,
      serviced_on: servicedOn,
      notes: field(formData, "notes") || null,
    },
  };
}

/**
 * How often the part is meant to be serviced, in the words the tab uses.
 *
 * Reuses `describeInterval()` from `lib/components.ts`, which already reads a
 * zero as "not measured" — the same rule the view applies when it coalesces the
 * columns.
 */
export function serviceIntervalLabel(row: ComponentServiceStatus): string {
  return describeInterval(row);
}

/**
 * "12 / 90 days · 38 / 200 km", for the measures that are actually counting.
 *
 * A kind measured only in hours shows only hours: printing "0 / 0 km" beside it
 * would suggest a target nobody set.
 */
export function serviceProgressLabel(row: ComponentServiceStatus): string {
  const measures: string[] = [];

  if (Number(row.interval_days) > 0) {
    measures.push(
      `${Number(row.days_since)} / ${Number(row.interval_days)} days`,
    );
  }
  if (Number(row.interval_km) > 0) {
    measures.push(`${Number(row.km_since)} / ${Number(row.interval_km)} km`);
  }
  if (Number(row.interval_hours) > 0) {
    measures.push(
      `${Number(row.hours_since)} / ${Number(row.interval_hours)} hours`,
    );
  }

  return measures.length > 0 ? measures.join(" · ") : "No interval set";
}

/** The row for one part, or `null` when it has no kind and so no interval. */
export function statusForComponent(
  rows: readonly ComponentServiceStatus[],
  componentId: string,
): ComponentServiceStatus | null {
  return rows.find((row) => row.component_id === componentId) ?? null;
}

/** One part's services, newest first — the order the card lists them in. */
export function serviceEventsForComponent(
  events: readonly ServiceEvent[],
  componentId: string,
): ServiceEvent[] {
  return events
    .filter((event) => event.component_id === componentId)
    .sort((a, b) => b.serviced_on.localeCompare(a.serviced_on));
}

/** "Mar 4, 2026" — read in UTC, so the day the operator typed cannot move. */
export function formatServicedOn(servicedOn: string): string {
  return formatDateRange(servicedOn, servicedOn);
}

/**
 * The line above the list: only what needs a decision.
 *
 * A shop with twelve parts and none due should read "Nothing due", not twelve
 * reassuring OKs.
 */
export function serviceSummary(
  rows: readonly ComponentServiceStatus[],
): string {
  if (rows.length === 0) return "No part has a service interval yet.";

  const overdue = rows.filter((row) => row.status === "overdue").length;
  const dueSoon = rows.filter((row) => row.status === "due_soon").length;

  if (overdue === 0 && dueSoon === 0) {
    return `Nothing due · ${rows.length} part${rows.length === 1 ? "" : "s"} counting`;
  }

  return [
    overdue > 0 ? `${overdue} overdue` : null,
    dueSoon > 0 ? `${dueSoon} due soon` : null,
    `${rows.length - overdue - dueSoon} OK`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
