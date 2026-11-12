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
import {
  addLineItem,
  assignRider,
  removeLineItem,
} from "@/lib/actions/bookings";
import {
  bookingTotals,
  formatBookingPrice,
  lineItemTotal,
  type Booking,
  type BookingLineItem,
  type Customer,
} from "@/lib/bookings";
import type { Tables } from "@/lib/supabase/types";

import { SELECT_CLASSES } from "../../fields";
import { AssignAssetForm, type AssignableAsset } from "./assign-asset-form";

/** The minimum a product needs to be offered in the picker. */
export type LineProduct = Pick<Tables<"products">, "id" | "title">;

/**
 * What the booking holds.
 *
 * A line names a product and, optionally, the unit that goes out. The window is
 * never shown per line: it is the booking's window, copied onto the line by the
 * trigger, and printing it twice would suggest the two could differ.
 *
 * The total is derived from the lines every render (`bookingTotals`) — nothing
 * stores it — so editing a line changes the figure with it.
 */
export function LineItemsSection({
  slug,
  booking,
  lines,
  customers,
  products,
  assets,
  canEdit,
}: {
  slug: string;
  booking: Booking;
  lines: BookingLineItem[];
  customers: Pick<Customer, "id" | "full_name" | "email">[];
  products: LineProduct[];
  assets: AssignableAsset[];
  canEdit: boolean;
}) {
  const totals = bookingTotals(lines);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lines</CardTitle>
        <CardDescription>
          What this booking holds. A line without a unit is a promise of “a bike
          like this”, which the desk allocates before collection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {canEdit
              ? "Nothing on this booking yet. Add a product below to reserve something."
              : "Nothing on this booking yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {lines.map((line) => (
              <LineRow
                key={line.id}
                slug={slug}
                reference={booking.reference}
                line={line}
                customers={customers}
                products={products}
                assets={assets}
                currency={booking.currency}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}

        <p className="text-sm font-medium">
          Total · {formatBookingPrice(totals.totalCents, booking.currency)}
        </p>

        {canEdit ? (
          <form
            action={addLineItem}
            className="grid gap-3 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_auto] sm:items-end"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="booking_id" value={booking.id} />
            <input type="hidden" name="reference" value={booking.reference} />

            <div className="space-y-2">
              <Label htmlFor="line-product">Product</Label>
              <select
                id="line-product"
                name="product_id"
                className={SELECT_CLASSES}
                disabled={products.length === 0}
              >
                <option value="">No product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="line-quantity">Qty</Label>
              <Input
                id="line-quantity"
                name="quantity"
                type="number"
                min={1}
                max={99}
                defaultValue={1}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="line-price">Price</Label>
              <Input
                id="line-price"
                name="unit_price"
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>

            <Button type="submit" variant="outline">
              Add line
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground text-xs">
            A staff member, manager, admin or owner can change the lines.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** One line: what it holds, how it is priced, and the two allocations. */
function LineRow({
  slug,
  reference,
  line,
  customers,
  products,
  assets,
  currency,
  canEdit,
}: {
  slug: string;
  reference: string;
  line: BookingLineItem;
  customers: Pick<Customer, "id" | "full_name" | "email">[];
  products: LineProduct[];
  assets: AssignableAsset[];
  currency: string;
  canEdit: boolean;
}) {
  const product = products.find((row) => row.id === line.product_id);
  const asset = assets.find((row) => row.id === line.asset_id);
  const rider = customers.find((row) => row.id === line.rider_id);

  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">
            {product?.title ?? (line.product_id ? "Product" : "Any unit")}
          </p>
          <p className="text-muted-foreground text-xs">
            {line.quantity} ×{" "}
            {formatBookingPrice(line.unit_price_cents, currency)} ={" "}
            {formatBookingPrice(lineItemTotal(line), currency)}
            {asset ? ` · ${asset.name}` : " · not allocated"}
            {rider ? ` · rider ${rider.full_name}` : ""}
          </p>
        </div>

        {canEdit ? (
          <form action={removeLineItem}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="reference" value={reference} />
            <input type="hidden" name="line_item_id" value={line.id} />
            <Button type="submit" size="sm" variant="ghost">
              Remove
            </Button>
          </form>
        ) : null}
      </div>

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssignAssetForm
            slug={slug}
            reference={reference}
            lineItemId={line.id}
            assetId={line.asset_id}
            assets={assets}
          />

          <form action={assignRider} className="flex items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="reference" value={reference} />
            <input type="hidden" name="line_item_id" value={line.id} />
            <label className="min-w-0 flex-1 space-y-1 text-xs">
              <span className="text-muted-foreground">Rider</span>
              <select
                name="rider_id"
                defaultValue={line.rider_id ?? ""}
                className={SELECT_CLASSES}
              >
                <option value="">The renter</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.full_name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
