import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUsageLog, updateUsageLog } from "@/lib/actions/usage";
import type { Asset } from "@/lib/assets";
import type { UsageLog } from "@/lib/usage";
import { cn } from "@/lib/utils";

import { TEXTAREA_CLASSES } from "../../../fields";

/** Today, as a date input wants it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The usage form's fields, shared by a reading's row and the "log a reading"
 * panel.
 *
 * `row` is the compact shape used for the readings already on the page — date,
 * hours, kilometres, a note and the buttons on one line — where the labels are
 * only for assistive technology because the column speaks for itself. `panel`
 * stacks the same fields in the slideout, with the labels visible.
 *
 * `actions` is the slot for Delete, posted with `formAction` from inside this
 * form rather than nesting a second one.
 */
export function UsageFields({
  slug,
  asset,
  log,
  layout = "row",
  formId,
  submitLabel,
  showSubmit = true,
  actions,
}: {
  slug: string;
  /** The unit the reading belongs to. */
  asset: Asset;
  log?: UsageLog;
  layout?: "row" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Extra buttons for the form's last column, left of the submit button. */
  actions?: ReactNode;
}) {
  const isEdit = Boolean(log);
  const compact = layout === "row";
  const fieldId = (name: string) =>
    `${formId ?? `usage-${log?.id ?? "new"}`}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateUsageLog : createUsageLog}
      className={cn(
        compact
          ? "grid gap-2 sm:grid-cols-[9rem_7rem_7rem_minmax(0,1fr)_auto] sm:items-center"
          : "grid gap-3",
      )}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="current_handle" value={asset.handle} />
      <input type="hidden" name="asset_id" value={asset.id} />
      {log ? <input type="hidden" name="usage_log_id" value={log.id} /> : null}

      <div className={cn("space-y-2", compact && "space-y-0")}>
        <Label htmlFor={fieldId("logged_on")} className={cn(compact && "sr-only")}>
          Day
        </Label>
        <Input
          id={fieldId("logged_on")}
          name="logged_on"
          type="date"
          defaultValue={log?.logged_on ?? today()}
          required
        />
      </div>

      <div className={cn("space-y-2", compact && "space-y-0")}>
        <Label htmlFor={fieldId("hours")} className={cn(compact && "sr-only")}>
          Hours
        </Label>
        <Input
          id={fieldId("hours")}
          name="hours"
          type="number"
          min={0}
          step="0.01"
          defaultValue={log ? String(Number(log.hours)) : ""}
          placeholder="0"
        />
      </div>

      <div className={cn("space-y-2", compact && "space-y-0")}>
        <Label
          htmlFor={fieldId("distance_km")}
          className={cn(compact && "sr-only")}
        >
          Kilometres
        </Label>
        <Input
          id={fieldId("distance_km")}
          name="distance_km"
          type="number"
          min={0}
          step="0.01"
          defaultValue={log ? String(Number(log.distance_km)) : ""}
          placeholder="0"
        />
      </div>

      <div className={cn("space-y-2", compact && "space-y-0")}>
        <Label htmlFor={fieldId("notes")} className={cn(compact && "sr-only")}>
          Notes
        </Label>
        {compact ? (
          <Input
            id={fieldId("notes")}
            name="notes"
            defaultValue={log?.notes ?? ""}
            placeholder="Optional"
            maxLength={400}
          />
        ) : (
          <textarea
            id={fieldId("notes")}
            name="notes"
            defaultValue={log?.notes ?? ""}
            className={TEXTAREA_CLASSES}
            rows={3}
            maxLength={400}
            placeholder="Rear brake rubbing, chain waxed"
          />
        )}
      </div>

      {showSubmit || actions ? (
        <div className="flex items-center gap-2">
          {actions}
          {showSubmit ? (
            <Button
              type="submit"
              size="sm"
              variant={isEdit ? "outline" : "default"}
            >
              {submitLabel ?? (isEdit ? "Save" : "Log reading")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {compact || !showSubmit ? null : (
        <p className="text-muted-foreground text-xs">
          Hours and kilometres are what happened since the previous reading, not
          a total. Either one alone is a reading.
        </p>
      )}
    </form>
  );
}
