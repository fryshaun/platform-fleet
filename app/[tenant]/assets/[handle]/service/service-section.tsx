import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteServiceEvent } from "@/lib/actions/servicing";
import type { Asset } from "@/lib/assets";
import {
  type AssetComponent,
  type ComponentKind,
  componentWhereLabel,
  fittedWindowLabel,
  isFitted,
} from "@/lib/components";
import {
  type ComponentServiceStatus,
  formatServicedOn,
  serviceEventsForComponent,
  serviceIntervalLabel,
  serviceProgressLabel,
  type ServiceEvent,
} from "@/lib/servicing";

import { ServiceStatusBadge } from "./service-badge";

/**
 * The service state of every part that has been on this unit.
 *
 * One card per part, and the card says three things: how often it should be
 * serviced (the kind's interval), how far it has got since the count started
 * (the view's sums, clipped to the fitting and the last service), and what has
 * been done to it (the events).
 *
 * A part that has come off keeps its card — the history is why the row survived
 * — but loses its status badge. The view still computes one from the clipped
 * window, and "Overdue" on a fork sitting in the parts bin is exactly the sort of
 * false alarm that teaches a shop to ignore the tab.
 */
export function ServiceSection({
  slug,
  asset,
  components,
  statuses,
  events,
  kinds,
  canDelete,
}: {
  slug: string;
  asset: Asset;
  /** Every part filed against this unit, fitted ones first. */
  components: readonly AssetComponent[];
  /** The derived status rows for this unit, keyed by component id. */
  statuses: Map<string, ComponentServiceStatus>;
  /** This unit's service events, in any order. */
  events: readonly ServiceEvent[];
  kinds: readonly ComponentKind[];
  /** The caller may delete a service event — manager and up. */
  canDelete: boolean;
}) {
  const kindNames = new Map(kinds.map((kind) => [kind.id, kind.name]));

  return (
    <ul className="space-y-4">
      {components.map((component) => {
        const status = statuses.get(component.id) ?? null;
        const services = serviceEventsForComponent(events, component.id);
        const fitted = isFitted(component);

        return (
          <li key={component.id}>
            <article
              aria-label={component.name}
              className="bg-card text-card-foreground flex flex-col gap-3 rounded-xl border p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{component.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {component.kind_id
                      ? (kindNames.get(component.kind_id) ?? "Kind removed")
                      : "No kind"}{" "}
                    · {componentWhereLabel(component, asset.name)} ·{" "}
                    {fittedWindowLabel(component)}
                  </p>
                </div>

                {fitted && status ? (
                  <ServiceStatusBadge status={status.status} />
                ) : null}
              </div>

              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Interval</dt>
                  <dd>
                    {status ? serviceIntervalLabel(status) : "No interval set"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    Since the count
                  </dt>
                  <dd>{status ? serviceProgressLabel(status) : "Not counted"}</dd>
                </div>
              </dl>

              <ServiceHistory
                slug={slug}
                asset={asset}
                services={services}
                canDelete={canDelete}
              />
            </article>
          </li>
        );
      })}
    </ul>
  );
}


/**
 * The services recorded against one part, newest first.
 *
 * Each row is its own tiny form posting `deleteServiceEvent` rather than a
 * button inside a record form: a service is one date and a note, nothing to edit
 * in place, and a wrong one is deleted and re-recorded.
 */
function ServiceHistory({
  slug,
  asset,
  services,
  canDelete,
}: {
  slug: string;
  asset: Asset;
  services: readonly ServiceEvent[];
  canDelete: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">Services</p>

      {services.length === 0 ? (
        <p className="text-sm">Nothing recorded.</p>
      ) : (
        <ul className="space-y-1">
          {services.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {formatServicedOn(event.serviced_on)}
                {event.notes ? (
                  <span className="text-muted-foreground">
                    {" — "}
                    {event.notes}
                  </span>
                ) : null}
              </span>

              {canDelete ? (
                <form action={deleteServiceEvent}>
                  <input type="hidden" name="slug" value={slug} />
                  <input
                    type="hidden"
                    name="current_handle"
                    value={asset.handle}
                  />
                  <input
                    type="hidden"
                    name="service_event_id"
                    value={event.id}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete the service from ${formatServicedOn(event.serviced_on)}`}
                  >
                    <Trash2Icon aria-hidden="true" />
                    Delete
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
