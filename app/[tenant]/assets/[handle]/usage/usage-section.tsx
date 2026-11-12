import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteUsageLog } from "@/lib/actions/usage";
import type { Asset } from "@/lib/assets";
import {
  formatDistance,
  formatHours,
  formatLoggedOn,
  type UsageLog,
} from "@/lib/usage";

import { UsageFields } from "./usage-fields";

/**
 * A unit's readings, newest first, each row a form.
 *
 * A reading is four numbers and a note, so a row is the whole record — no card,
 * no page. Editing happens in place because the copy on the worksheet is often a
 * digit out, and deleting is the manager's way to take back a reading that was
 * never made.
 *
 * The totals are not here: they are one line above the list, derived from these
 * same rows by `summariseUsage()`.
 */
export function UsageSection({
  slug,
  asset,
  logs,
  canEdit,
  canDelete,
}: {
  slug: string;
  asset: Asset;
  /** This unit's readings, newest first. */
  logs: readonly UsageLog[];
  /** The caller may log and correct readings — front desk and up, when writable. */
  canEdit: boolean;
  /** The caller may delete a reading — manager and up. */
  canDelete: boolean;
}) {
  return (
    <ul className="divide-y rounded-xl border">
      {logs.map((log) => (
        <li key={log.id} className="p-3">
          {canEdit ? (
            <UsageFields
              slug={slug}
              asset={asset}
              log={log}
              formId={`usage-${log.id}`}
              submitLabel="Save"
              actions={
                canDelete ? (
                  <Button
                    type="submit"
                    formAction={deleteUsageLog}
                    formNoValidate
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete the reading from ${formatLoggedOn(log.logged_on)}`}
                  >
                    <Trash2Icon aria-hidden="true" />
                    Delete
                  </Button>
                ) : null
              }
            />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_7rem_7rem_minmax(0,1fr)]">
              <div>
                <dt className="text-muted-foreground text-xs">Day</dt>
                <dd>{formatLoggedOn(log.logged_on)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Hours</dt>
                <dd>{Number(log.hours) > 0 ? formatHours(log.hours) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Distance</dt>
                <dd>
                  {Number(log.distance_km) > 0
                    ? formatDistance(log.distance_km)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Notes</dt>
                <dd>{log.notes ?? "—"}</dd>
              </div>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
