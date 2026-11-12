import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAsset, updateAsset } from "@/lib/actions/assets";
import { ASSET_STATUS_OPTIONS, type Asset } from "@/lib/assets";
import { cn } from "@/lib/utils";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../fields";

/** The minimum a product needs to be offered in the picker. */
export type AssetProductOption = {
  id: string;
  title: string;
  handle: string;
};

/**
 * The asset form's fields, shared by the edit card and the "new asset" panel.
 *
 * The two only differ in how wide they are drawn and in who owns the submit
 * button: the panel keeps "Add asset" in its footer (next to Cancel), so it
 * passes `showSubmit={false}` and an id the footer button can target with
 * `form=`. Everything about the fields themselves lives here, once.
 *
 * The product picker only appears when the products section is on. With it off
 * the form still works — a fleet can be recorded before the catalogue exists —
 * and a hidden field carries the current assignment through untouched.
 */
export function AssetFields({
  slug,
  products,
  asset,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
}: {
  slug: string;
  products: AssetProductOption[];
  asset?: Asset;
  /** `card` is a two-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
}) {
  const isEdit = Boolean(asset);
  const canAssign = products.length > 0;
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  // The ids have to be unique per form, because the panel and the edit card can
  // both be in the document at once.
  const fieldId = (name: string) => `${formId ?? "asset"}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateAsset : createAsset}
      className={cn("grid gap-4", twoColumn && "sm:grid-cols-2")}
    >
      <input type="hidden" name="slug" value={slug} />
      {asset ? (
        <>
          <input type="hidden" name="asset_id" value={asset.id} />
          <input type="hidden" name="current_handle" value={asset.handle} />
        </>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          name="name"
          defaultValue={asset?.name ?? ""}
          placeholder="bike-1"
          required
          maxLength={80}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("handle")}>Address</Label>
        <Input
          id={fieldId("handle")}
          name="handle"
          defaultValue={asset?.handle ?? ""}
          placeholder="derived from the name"
          maxLength={50}
        />
        <p className="text-muted-foreground text-xs">
          The last part of the URL. Empty derives it from the name when creating,
          and keeps the current address when editing.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("serial")}>Serial number</Label>
        <Input
          id={fieldId("serial")}
          name="serial"
          defaultValue={asset?.serial ?? ""}
          maxLength={120}
        />
        <p className="text-muted-foreground text-xs">
          Optional, and unique per workspace when set.
        </p>
      </div>

      {asset?.status === "rented" ? (
        // A rented unit's status belongs to its booking (migration 25 writes it
        // from the lines beneath the unit), so the form does not offer it. The
        // action keeps the stored status when none is posted, which is why
        // saving the rest of the record cannot quietly un-rent the unit.
        <div className="space-y-2">
          <p className="text-sm font-medium">Status</p>
          <p className="text-brand-forest bg-brand-lime inline-flex rounded-md px-2 py-0.5 text-sm">
            Out on hire
          </p>
          <p className="text-muted-foreground text-xs">
            Set by the booking that holds it, and cleared when that booking is
            completed or cancelled.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={fieldId("status")}>Status</Label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue={asset?.status ?? "available"}
            className={SELECT_CLASSES}
          >
            {ASSET_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {canAssign ? (
        <div className="space-y-2">
          <Label htmlFor={fieldId("product")}>Product</Label>
          <select
            id={fieldId("product")}
            name="product_id"
            defaultValue={asset?.product_id ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Not assigned</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <input
            type="hidden"
            name="product_id"
            value={asset?.product_id ?? ""}
          />
          <p className="text-muted-foreground self-end text-xs">
            Switch the products section on to assign this unit to a product.
          </p>
        </>
      )}

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("notes")}>Notes</Label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          defaultValue={asset?.notes ?? ""}
          className={TEXTAREA_CLASSES}
        />
      </div>

      {showSubmit ? (
        <div className={wide}>
          <Button type="submit">
            {submitLabel ?? (isEdit ? "Save asset" : "Add asset")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
