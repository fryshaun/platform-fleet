import Link from "next/link";

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
import { createVariant } from "@/lib/actions/products";
import {
  formatProductPrice,
  type Product,
} from "@/lib/products";

import { ProductStatusBadge, StockBadge } from "../product-badges";

/**
 * The variants of a product.
 *
 * A variant is its own `products` row, so it has its own price, SKU, stock and
 * gallery; this card only lists them and offers the "add another" form. One
 * level only — the database refuses a variant of a variant, and a variant page
 * renders no variants card at all.
 */
export function VariantsSection({
  slug,
  product,
  variants,
  canEdit,
}: {
  slug: string;
  product: Product;
  variants: Product[];
  canEdit: boolean;
}) {
  if (product.parent_id) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Variants</CardTitle>
        <CardDescription>
          Sizes, colours or pack sizes — each one is sold, priced and stocked on
          its own. Add a variant for every option a customer can pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {variants.length === 0 ? (
          <p className="text-muted-foreground text-sm">No variants yet.</p>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {variants.map((variant) => (
              <li
                key={variant.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/${slug}/products/${variant.handle}`}
                    className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {variant.title}
                  </Link>
                  <p className="text-muted-foreground truncate text-xs">
                    {formatProductPrice(variant)}
                    {variant.sku ? ` · ${variant.sku}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <ProductStatusBadge status={variant.status} />
                  <StockBadge product={variant} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form
            action={createVariant}
            className="grid gap-3 border-t pt-6 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="parent_id" value={product.id} />
            <input type="hidden" name="current_handle" value={product.handle} />

            <div className="space-y-2">
              <Label htmlFor="variant-title">Variant name</Label>
              <Input
                id="variant-title"
                name="title"
                required
                maxLength={160}
                placeholder="Large"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="variant-price">Price</Label>
              <Input
                id="variant-price"
                name="price"
                inputMode="decimal"
                placeholder="same as parent"
              />
            </div>

            <Button type="submit" variant="outline">
              Add variant
            </Button>

            <p className="text-muted-foreground text-xs sm:col-span-3">
              The address is derived from the product and the variant name, and
              the variant inherits this product&apos;s category, status,
              currency and stocking method.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
