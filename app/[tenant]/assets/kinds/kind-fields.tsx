import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createComponentKind, updateComponentKind } from "@/lib/actions/asset-components";
import {
  type ComponentKind,
  intervalFieldName,
  intervalInputValue,
  SERVICE_INTERVAL_FIELDS,
  SERVICE_INTERVAL_UNITS,
} from "@/lib/components";
import { cn } from "@/lib/utils";

/**
 * The kind form's fields, shared by the deck's edit cards and the "new kind"
 * panel.
 *
 * The same shape as the category form — a deck of forms rather than a detail
 * page — with one addition: the three service intervals. They are rendered from
 * `SERVICE_INTERVAL_UNITS` so the inputs and the parser cannot disagree about
 * which units exist.
 *
 * `actions` is the same slot the category deck uses for Delete: a button that
 * belongs to this form but not to its fields, posted with `formAction`.
 */
export function KindFields({
  slug,
  kind,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
  actions,
}: {
  slug: string;
  kind?: ComponentKind;
  /** `card` is a three-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Extra buttons for the form's last row, left of the submit button. */
  actions?: ReactNode;
}) {
  const isEdit = Boolean(kind);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  const fieldId = (name: string) =>
    `${formId ?? `kind-${kind?.id ?? "new"}`}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateComponentKind : createComponentKind}
      className={cn("grid gap-3", twoColumn && "sm:grid-cols-3")}
    >
      <input type="hidden" name="slug" value={slug} />
      {kind ? (
        <>
          <input type="hidden" name="kind_id" value={kind.id} />
          <input type="hidden" name="current_handle" value={kind.handle} />
        </>
      ) : null}

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          name="name"
          defaultValue={kind?.name ?? ""}
          required
          maxLength={80}
          placeholder="Fork"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("position")}>Order</Label>
        <Input
          id={fieldId("position")}
          name="position"
          type="number"
          min={0}
          defaultValue={kind?.position ?? 0}
        />
      </div>

      <div className={cn("space-y-2", twoColumn && "sm:col-span-3")}>
        <Label htmlFor={fieldId("handle")}>Address</Label>
        <Input
          id={fieldId("handle")}
          name="handle"
          defaultValue={kind?.handle ?? ""}
          placeholder="derived from the name"
          maxLength={50}
        />
      </div>

      {SERVICE_INTERVAL_UNITS.map((unit) => {
        const field = SERVICE_INTERVAL_FIELDS[unit];
        const id = fieldId(intervalFieldName(unit));

        return (
          <div key={unit} className="space-y-2">
            <Label htmlFor={id}>{field.label}</Label>
            <Input
              id={id}
              name={intervalFieldName(unit)}
              type="number"
              min={0}
              step={field.step}
              defaultValue={intervalInputValue(
                kind?.[intervalFieldName(unit)] ?? null,
              )}
              placeholder={field.placeholder}
              aria-describedby={`${id}-hint`}
            />
            <p id={`${id}-hint`} className="text-muted-foreground text-xs">
              {field.hint}
            </p>
          </div>
        );
      })}

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
              {submitLabel ?? (isEdit ? "Save kind" : "Add kind")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
