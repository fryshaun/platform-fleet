import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createServiceEvent } from "@/lib/actions/servicing";
import type { Asset } from "@/lib/assets";
import type { AssetComponent } from "@/lib/components";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../../../fields";

/** Today, as a date input wants it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The "record a service" form.
 *
 * One form for the whole tab rather than one per part: the desk knows which part
 * it just serviced, and a picker makes the choice explicit instead of relying on
 * which card the button was under.
 *
 * Only the fitted parts are offered — a part in the parts bin was not serviced on
 * this unit, and a service dated after a removal would be counted against a
 * window that ends before it.
 */
export function ServiceFields({
  slug,
  asset,
  components,
  formId,
  submitLabel,
  showSubmit = true,
}: {
  slug: string;
  asset: Asset;
  /** The parts currently fitted to this unit. */
  components: readonly AssetComponent[];
  /** Id of the `<form>`, so the panel's footer button can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
}) {
  const fieldId = (name: string) => `${formId ?? "service"}-${name}`;

  return (
    <form id={formId} action={createServiceEvent} className="grid gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="current_handle" value={asset.handle} />

      <div className="space-y-2">
        <Label htmlFor={fieldId("component")}>Part</Label>
        <select
          id={fieldId("component")}
          name="component_id"
          required
          defaultValue={components.length === 1 ? components[0].id : ""}
          className={SELECT_CLASSES}
        >
          <option value="" disabled>
            Choose a part
          </option>
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.name}
              {component.serial ? ` · ${component.serial}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("serviced_on")}>Serviced on</Label>
        <Input
          id={fieldId("serviced_on")}
          name="serviced_on"
          type="date"
          defaultValue={today()}
          required
        />
        <p className="text-muted-foreground text-xs">
          The interval counts from this day, not from when it was typed in.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("notes")}>Notes</Label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          className={TEXTAREA_CLASSES}
          rows={3}
          maxLength={400}
          placeholder="Seals replaced, oil weight 5w"
        />
      </div>

      {showSubmit ? (
        <div>
          <Button type="submit">{submitLabel ?? "Record service"}</Button>
        </div>
      ) : null}
    </form>
  );
}
