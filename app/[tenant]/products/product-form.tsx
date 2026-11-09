import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "./fields";

/**
 * The product editor, used for both "new" and "edit".
 *
 * One component rather than two because the fields are identical and the only
 * differences — which action runs, whether the address is prefilled — are two
 * props. Everything is a plain form posting to a Server Action: the page stays
 * server-rendered and the result arrives as `?ok=` / `?error=`.
 */
export function ProductForm({
  slug,
  categories,
  product,
}: {
  slug: string;
  categories: Pick<ProductCategory, "id" | "name">[];
  product?: Product;
}) {
  const isEdit = Boolean(product);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Details" : "New product"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Name, address, price and where this product sits in the shop."
            : "Start with the basics. Stock, variants, dates and gallery media are added from the product page afterwards."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={isEdit ? updateProduct : createProduct}
          className="grid gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="slug" value={slug} />
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
            <Label htmlFor="product-title">Name</Label>
            <Input
              id="product-title"
              name="title"
              defaultValue={product?.title ?? ""}
              required
              maxLength={160}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-handle">Address</Label>
            <Input
              id="product-handle"
              name="handle"
              defaultValue={product?.handle ?? ""}
              placeholder="derived from the name"
              maxLength={50}
            />
            <p className="text-muted-foreground text-xs">
              The last part of the URL. Empty derives it from the name when
              creating, and keeps the current address when editing.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-category">Category</Label>
            <select
              id="product-category"
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
            <Label htmlFor="product-status">Status</Label>
            <select
              id="product-status"
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
            <Label htmlFor="product-kind">Stocked as</Label>
            <select
              id="product-kind"
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
            <Label htmlFor="product-currency">Currency</Label>
            <select
              id="product-currency"
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
            <Label htmlFor="product-price">Price</Label>
            <Input
              id="product-price"
              name="price"
              inputMode="decimal"
              defaultValue={priceInputValue(product?.price_cents ?? 0)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-compare-at">Compare-at price</Label>
            <Input
              id="product-compare-at"
              name="compare_at_price"
              inputMode="decimal"
              defaultValue={priceInputValue(
                product?.compare_at_price_cents ?? null,
              )}
              placeholder="optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              name="sku"
              defaultValue={product?.sku ?? ""}
              maxLength={64}
              placeholder="optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-supplier">Supplier</Label>
            <Input
              id="product-supplier"
              name="supplier"
              defaultValue={product?.supplier ?? ""}
              maxLength={120}
              placeholder="optional"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="product-description">Description</Label>
            <textarea
              id="product-description"
              name="description"
              defaultValue={product?.description ?? ""}
              className={TEXTAREA_CLASSES}
              rows={4}
            />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit">
              {isEdit ? "Save product" : "Create product"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
