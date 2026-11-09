import { Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { addProductDate, deleteProductDate } from "@/lib/actions/products";
import {
  formatDateRange,
  formatPriceCents,
  type Product,
  type ProductDate,
} from "@/lib/products";

/**
 * Date-based inventory: one row per window, each with its own stock.
 *
 * Only rendered for `kind = "dated"` products, which is what makes the two
 * stocking models exclusive: a product either counts one number or books
 * windows, never both.
 */
export function DatesSection({
  slug,
  product,
  dates,
  canEdit,
}: {
  slug: string;
  product: Product;
  dates: ProductDate[];
  canEdit: boolean;
}) {
  if (product.kind !== "dated") {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dates</CardTitle>
        <CardDescription>
          Bookable windows with their own stock — course runs, seasons or hire
          periods. Leave the price empty to use the product price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {dates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No dates yet.</p>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {dates.map((date) => (
              <li
                key={date.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {formatDateRange(date.starts_on, date.ends_on)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {date.price_cents === null
                      ? "Product price"
                      : formatPriceCents(date.price_cents, product.currency)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={date.inventory_quantity === 0 ? "destructive" : "outline"}>
                    {date.inventory_quantity === 0
                      ? "Fully booked"
                      : `${date.inventory_quantity} available`}
                  </Badge>

                  {canEdit ? (
                    <form action={deleteProductDate}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="current_handle" value={product.handle} />
                      <input type="hidden" name="date_id" value={date.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        <Trash2Icon aria-hidden="true" />
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form
            action={addProductDate}
            className="grid gap-3 border-t pt-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_8rem_auto] sm:items-end"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="current_handle" value={product.handle} />

            <div className="space-y-2">
              <Label htmlFor="date-starts-on">Starts</Label>
              <Input id="date-starts-on" name="starts_on" type="date" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-ends-on">Ends</Label>
              <Input id="date-ends-on" name="ends_on" type="date" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-quantity">Available</Label>
              <Input
                id="date-quantity"
                name="inventory_quantity"
                type="number"
                min={0}
                step={1}
                defaultValue={0}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-price">Price</Label>
              <Input
                id="date-price"
                name="price"
                inputMode="decimal"
                placeholder="optional"
              />
            </div>

            <Button type="submit" variant="outline">
              Add dates
            </Button>

            <p className="text-muted-foreground text-xs sm:col-span-5">
              Leave the end date empty for a single day.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
