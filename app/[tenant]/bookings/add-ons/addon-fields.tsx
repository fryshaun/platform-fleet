import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAddon, updateAddon } from "@/lib/actions/addons";
import {
  ADDON_PRICE_KIND_OPTIONS,
  ADDON_STATUSES,
  ADDON_STATUS_LABELS,
  MAX_ADDON_QUANTITY,
  MAX_ADDON_STOCK,
  type Addon,
} from "@/lib/addons";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../../fields";

/** The minimum a product needs to appear in the scope picker. */
export type ScopeProduct = Pick<
  Tables<"products">,
  "id" | "title" | "parent_id"
>;

/**
 * The extra form's fields, shared by the deck's cards and the "new extra" panel.
 *
 * Every card posts this same field set to `updateAddon`, and the panel posts the
 * empty one to `createAddon`, so a card and the panel cannot disagree about what
 * an extra has.
 *
 * The scope block is the one part that depends on another section: with products
 * switched off there is nothing to tick, so no `scope` marker is sent and the
 * action leaves whatever scope rows exist alone. Sending an empty list instead
 * would quietly widen a scoped extra to every product.
 */
export function AddonFields({
  slug,
  addon,
  products,
  scopedProductIds,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
  actions,
}: {
  slug: string;
  addon?: Addon;
  /** Products the scope picker offers; empty when that section is off. */
  products: ScopeProduct[];
  /** Product ids this extra is currently scoped to. */
  scopedProductIds: string[];
  /** `card` is a three-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Extra buttons for the form's last row, left of the submit button. */
  actions?: ReactNode;
}) {
  const isEdit = Boolean(addon);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  const fieldId = (name: string) =>
    `${formId ?? `addon-${addon?.id ?? "new"}`}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateAddon : createAddon}
      className={cn("grid gap-3", twoColumn && "sm:grid-cols-3")}
    >
      <input type="hidden" name="slug" value={slug} />
      {addon ? (
        <>
          <input type="hidden" name="addon_id" value={addon.id} />
          <input type="hidden" name="current_handle" value={addon.handle} />
        </>
      ) : null}

      <div className={cn("space-y-2", twoColumn && "sm:col-span-2")}>
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          name="name"
          defaultValue={addon?.name ?? ""}
          required
          maxLength={120}
          placeholder="Helmet"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("price")}>Price</Label>
        <Input
          id={fieldId("price")}
          name="price"
          inputMode="decimal"
          defaultValue={addon ? (addon.price_cents / 100).toFixed(2) : ""}
          placeholder="5.00"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("price_kind")}>Charged</Label>
        <select
          id={fieldId("price_kind")}
          name="price_kind"
          defaultValue={addon?.price_kind ?? "per_booking"}
          className={SELECT_CLASSES}
        >
          {ADDON_PRICE_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("max_quantity")}>Most per line</Label>
        <Input
          id={fieldId("max_quantity")}
          name="max_quantity"
          type="number"
          min={1}
          max={MAX_ADDON_QUANTITY}
          defaultValue={addon?.max_quantity ?? 1}
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("track_stock")}>Stock</Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={fieldId("track_stock")}
            type="checkbox"
            name="track_stock"
            defaultChecked={addon?.track_stock ?? false}
          />
          <span>
            Count these, and refuse a booking that would take more than the shop
            owns
          </span>
        </label>
        <Input
          name="quantity_on_hand"
          type="number"
          min={0}
          max={MAX_ADDON_STOCK}
          defaultValue={addon?.quantity_on_hand ?? 0}
          aria-label="How many the shop owns"
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("handle")}>Address</Label>
        <Input
          id={fieldId("handle")}
          name="handle"
          defaultValue={addon?.handle ?? ""}
          placeholder="derived from the name"
          maxLength={50}
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("description")}>Description</Label>
        <textarea
          id={fieldId("description")}
          name="description"
          defaultValue={addon?.description ?? ""}
          className={TEXTAREA_CLASSES}
          rows={twoColumn ? 2 : 3}
          maxLength={400}
          placeholder="Optional"
        />
      </div>

      {addon ? (
        <div className="space-y-2">
          <Label htmlFor={fieldId("status")}>Status</Label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue={addon.status}
            className={SELECT_CLASSES}
          >
            {ADDON_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ADDON_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {products.length > 0 ? (
        <fieldset className={cn("space-y-2", wide)}>
          {/* The marker is what tells `updateAddon` that the list in this form
              is the whole scope. Without it the action leaves the scope alone,
              which is what a form without the picker needs. */}
          <input type="hidden" name="scope" value="1" />
          <legend className="text-sm font-medium">Offered with</legend>
          <p className="text-muted-foreground text-xs">
            Tick nothing to offer it on every product. A variant is covered when
            its parent is ticked.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {products.map((product) => (
              <label
                key={product.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="product_ids"
                  value={product.id}
                  defaultChecked={scopedProductIds.includes(product.id)}
                />
                <span className="truncate">{product.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

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
              {submitLabel ?? (isEdit ? "Save extra" : "Add extra")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
