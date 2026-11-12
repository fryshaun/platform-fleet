import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createComponent, updateComponent } from "@/lib/actions/asset-components";
import type { Asset } from "@/lib/assets";
import type { AssetComponent, ComponentKind } from "@/lib/components";
import { cn } from "@/lib/utils";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../../../fields";

/** Today, as a date input wants it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The component form's fields, shared by the row on a unit and the "add part"
 * panel.
 *
 * A part belongs to a unit here, so `asset_id` is a hidden field rather than a
 * picker: the tab is already about one unit, and a picker would invite misfiling
 * a part onto another bike from the wrong page.
 *
 * `actions` is the slot for Remove and Delete — buttons that belong to this form
 * but not to its fields, posted with `formAction`. Removing is a date, not a
 * delete: the row keeps its serial and its service history.
 */
export function ComponentFields({
  slug,
  asset,
  kinds,
  component,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
  actions,
}: {
  slug: string;
  /** The unit the part is filed against. */
  asset: Asset;
  kinds: readonly ComponentKind[];
  component?: AssetComponent;
  /** `card` is a two-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Extra buttons for the form's last row, left of the submit button. */
  actions?: ReactNode;
}) {
  const isEdit = Boolean(component);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  const fieldId = (name: string) =>
    `${formId ?? `component-${component?.id ?? "new"}`}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateComponent : createComponent}
      className={cn("grid gap-3", twoColumn && "sm:grid-cols-2")}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="current_handle" value={asset.handle} />
      <input
        type="hidden"
        name="asset_id"
        value={component ? (component.asset_id ?? "") : asset.id}
      />
      {component ? (
        <input type="hidden" name="component_id" value={component.id} />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          name="name"
          defaultValue={component?.name ?? ""}
          required
          maxLength={120}
          placeholder="Fox 36"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("serial")}>Serial number</Label>
        <Input
          id={fieldId("serial")}
          name="serial"
          defaultValue={component?.serial ?? ""}
          maxLength={120}
          placeholder="Optional"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("kind")}>Kind</Label>
        <select
          id={fieldId("kind")}
          name="kind_id"
          defaultValue={component?.kind_id ?? ""}
          className={SELECT_CLASSES}
        >
          <option value="">No kind</option>
          {kinds.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={fieldId("fitted_on")}>Fitted</Label>
          <Input
            id={fieldId("fitted_on")}
            name="fitted_on"
            type="date"
            defaultValue={component?.fitted_on ?? today()}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={fieldId("removed_on")}>Removed</Label>
          <Input
            id={fieldId("removed_on")}
            name="removed_on"
            type="date"
            defaultValue={component?.removed_on ?? ""}
          />
        </div>
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("notes")}>Notes</Label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          defaultValue={component?.notes ?? ""}
          className={TEXTAREA_CLASSES}
          rows={twoColumn ? 2 : 3}
          placeholder="What was done, which workshop, which batch"
        />
      </div>

      {showSubmit || actions ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2",
            wide,
          )}
        >
          <div className="flex items-center gap-2">{actions}</div>
          {showSubmit ? (
            <Button type="submit" variant={isEdit ? "outline" : "default"}>
              {submitLabel ?? (isEdit ? "Save part" : "Fit part")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
