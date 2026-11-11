import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCategory, updateCategory } from "@/lib/actions/products";
import type { ProductCategory } from "@/lib/products";
import { cn } from "@/lib/utils";

import { TEXTAREA_CLASSES } from "../../fields";

/**
 * The category form's fields, shared by the deck's edit cards and the "new
 * category" panel.
 *
 * Unlike the product form there is no detail page to edit a category on, so the
 * deck is made of forms: every card posts this same field set to
 * `updateCategory`, and the panel posts the empty one to `createCategory`.
 * Drawing them here keeps a card and the panel from disagreeing about what a
 * category has.
 *
 * `actions` is a slot for buttons that belong to the same form but not to the
 * fields — the deck puts Delete there, and it posts to `deleteCategory` through
 * `formAction` rather than nesting a second `<form>` inside the first.
 */
export function CategoryFields({
  slug,
  category,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
  actions,
}: {
  slug: string;
  category?: ProductCategory;
  /**
   * `card` is a three-column grid with the name spanning two; `panel` stacks the
   * fields in the slideout.
   */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Extra buttons for the form's last row, left of the submit button. */
  actions?: ReactNode;
}) {
  const isEdit = Boolean(category);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  // One deck holds a form per category, so the ids carry the category rather
  // than only the field name.
  const fieldId = (name: string) =>
    `${formId ?? `category-${category?.id ?? "new"}`}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateCategory : createCategory}
      className={cn("grid gap-3", twoColumn && "sm:grid-cols-3")}
    >
      <input type="hidden" name="slug" value={slug} />
      {category ? (
        <>
          <input type="hidden" name="category_id" value={category.id} />
          <input
            type="hidden"
            name="current_handle"
            value={category.handle}
          />
        </>
      ) : null}

      <div className={cn("space-y-2", twoColumn && "sm:col-span-2")}>
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          name="name"
          defaultValue={category?.name ?? ""}
          required
          maxLength={120}
          placeholder="Beverages"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("position")}>Order</Label>
        <Input
          id={fieldId("position")}
          name="position"
          type="number"
          min={0}
          defaultValue={category?.position ?? 0}
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("handle")}>Address</Label>
        <Input
          id={fieldId("handle")}
          name="handle"
          defaultValue={category?.handle ?? ""}
          placeholder="derived from the name"
          maxLength={50}
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("description")}>Description</Label>
        <textarea
          id={fieldId("description")}
          name="description"
          defaultValue={category?.description ?? ""}
          className={TEXTAREA_CLASSES}
          rows={twoColumn ? 2 : 3}
          maxLength={400}
          placeholder="Optional"
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
              {submitLabel ?? (isEdit ? "Save category" : "Add category")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
