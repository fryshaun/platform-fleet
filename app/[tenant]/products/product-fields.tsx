import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProduct, updateProduct } from "@/lib/actions/products";
import {
  priceInputValue,
  PRODUCT_CURRENCY_OPTIONS,
  PRODUCT_KIND_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  type Product,
  type ProductCategory,
} from "@/lib/products";
import { cn } from "@/lib/utils";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../fields";

/** The minimum a category needs to be offered in the picker. */
export type ProductCategoryOption = Pick<ProductCategory, "id" | "name">;

/**
 * The product form's fields, shared by the edit card and the "new product"
 * panel.
 *
 * The two only differ in how wide they are drawn and in who owns the submit
 * button: the panel keeps "Create product" in its footer (next to Cancel), so it
 * passes `showSubmit={false}` and an id the footer button can target with
 * `form=`. Everything about the fields themselves lives here, once.
 *
 * `surface` says which of the two surfaces is posting. A create that fails has
 * to come back to the form the author was using — the panel on the index, or the
 * standalone `/products/new` page — and a flag is used rather than a path so
 * nothing from the browser reaches a redirect.
 */
export function ProductFields({
  slug,
  categories,
  product,
  layout = "card",
  formId,
  submitLabel,
  showSubmit = true,
  surface,
}: {
  slug: string;
  categories: ProductCategoryOption[];
  product?: Product;
  /** `card` is a two-column grid; `panel` stacks the fields in the slideout. */
  layout?: "card" | "panel";
  /** Id of the `<form>`, so a button outside it can submit it with `form=`. */
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  /** Where a failed create returns to; ignored when editing. */
  surface?: "page" | "panel";
}) {
  const isEdit = Boolean(product);
  const twoColumn = layout === "card";
  const wide = twoColumn ? "sm:col-span-2" : undefined;
  // The ids have to be unique per form, because the panel and the edit card can
  // both be in the document at once.
  const fieldId = (name: string) => `${formId ?? "product"}-${name}`;

  return (
    <form
      id={formId}
      action={isEdit ? updateProduct : createProduct}
      className={cn("grid gap-4", twoColumn && "sm:grid-cols-2")}
    >
      <input type="hidden" name="slug" value={slug} />
      {surface && !isEdit ? (
        <input type="hidden" name="surface" value={surface} />
      ) : null}
      {product ? (
        <>
          <input type="hidden" name="product_id" value={product.id} />
          <input
            type="hidden"
            name="current_handle"
            value={product.handle}
          />
        </>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={fieldId("title")}>Name</Label>
        <Input
          id={fieldId("title")}
          name="title"
          defaultValue={product?.title ?? ""}
          required
          maxLength={160}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("handle")}>Address</Label>
        <Input
          id={fieldId("handle")}
          name="handle"
          defaultValue={product?.handle ?? ""}
          placeholder="derived from the name"
          maxLength={50}
        />
        <p className="text-muted-foreground text-xs">
          The last part of the URL. Empty derives it from the name when creating,
          and keeps the current address when editing.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("category")}>Category</Label>
        <select
          id={fieldId("category")}
          name="category_id"
          defaultValue={product?.category_id ?? ""}
          className={SELECT_CLASSES}
        >
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("status")}>Status</Label>
        <select
          id={fieldId("status")}
          name="status"
          defaultValue={product?.status ?? "draft"}
          className={SELECT_CLASSES}
        >
          {PRODUCT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("kind")}>Stocked as</Label>
        <select
          id={fieldId("kind")}
          name="kind"
          defaultValue={product?.kind ?? "item"}
          className={SELECT_CLASSES}
        >
          {PRODUCT_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("currency")}>Currency</Label>
        <select
          id={fieldId("currency")}
          name="currency"
          defaultValue={product?.currency ?? "usd"}
          className={SELECT_CLASSES}
        >
          {PRODUCT_CURRENCY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("price")}>Price</Label>
        <Input
          id={fieldId("price")}
          name="price"
          inputMode="decimal"
          defaultValue={priceInputValue(product?.price_cents ?? 0)}
          placeholder="0.00"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("compare-at")}>Compare-at price</Label>
        <Input
          id={fieldId("compare-at")}
          name="compare_at_price"
          inputMode="decimal"
          defaultValue={priceInputValue(product?.compare_at_price_cents ?? null)}
          placeholder="optional"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("sku")}>SKU</Label>
        <Input
          id={fieldId("sku")}
          name="sku"
          defaultValue={product?.sku ?? ""}
          maxLength={64}
          placeholder="optional"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("supplier")}>Supplier</Label>
        <Input
          id={fieldId("supplier")}
          name="supplier"
          defaultValue={product?.supplier ?? ""}
          maxLength={120}
          placeholder="optional"
        />
      </div>

      <div className={cn("space-y-2", wide)}>
        <Label htmlFor={fieldId("description")}>Description</Label>
        <textarea
          id={fieldId("description")}
          name="description"
          defaultValue={product?.description ?? ""}
          className={TEXTAREA_CLASSES}
          rows={4}
        />
      </div>

      {showSubmit ? (
        <div className={wide}>
          <Button type="submit">
            {submitLabel ?? (isEdit ? "Save product" : "Create product")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
