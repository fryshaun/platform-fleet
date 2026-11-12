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
import { addLineAddon, removeLineAddon, updateLineAddon } from "@/lib/actions/addons";
import {
  addLineItem,
  assignRider,
  removeLineItem,
} from "@/lib/actions/bookings";
import {
  bookingAddonsTotal,
  addonChargeCents,
  addonPriceLabel,
  addonScopeByAddon,
  addonsForLine,
  type Addon,
  type AddonProduct,
  type BookingLineAddon,
} from "@/lib/addons";
import {
  bookingDays,
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
import {
  AssignComponentForm,
  type AssignableComponent,
} from "./assign-component-form";

/**
 * The minimum a product needs to be offered in the picker.
 *
 * `parent_id` is here for the extras: an extra scoped to a parent product is
 * offered with every variant of it, which is the normal case.
 */
export type LineProduct = Pick<Tables<"products">, "id" | "title" | "parent_id">;

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
  components,
  addons,
  addonScope,
  lineAddons,
  canEdit,
}: {
  slug: string;
  booking: Booking;
  lines: BookingLineItem[];
  customers: Pick<Customer, "id" | "full_name" | "email">[];
  products: LineProduct[];
  assets: AssignableAsset[];
  /** The parts a line may book instead of a whole unit. */
  components: AssignableComponent[];
  addons: Addon[];
  addonScope: AddonProduct[];
  lineAddons: BookingLineAddon[];
  canEdit: boolean;
}) {
  const totals = bookingTotals(lines);
  const days = bookingDays(booking.starts_on, booking.ends_on);
  const extrasCents = bookingAddonsTotal(
    lineAddons,
    booking.starts_on,
    booking.ends_on,
  );
  const scopeByAddon = addonScopeByAddon(addonScope);

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
            {lines.map((line) => {
              const product = products.find((row) => row.id === line.product_id);

              return (
                <LineRow
                  key={line.id}
                  slug={slug}
                  reference={booking.reference}
                  line={line}
                  customers={customers}
                  products={products}
                  assets={assets}
                  components={components}
                  currency={booking.currency}
                  days={days}
                  addons={addons}
                  offered={addonsForLine(addons, scopeByAddon, {
                    product_id: line.product_id,
                    parent_id: product?.parent_id ?? null,
                  })}
                  extras={lineAddons.filter(
                    (row) => row.line_item_id === line.id,
                  )}
                  canEdit={canEdit}
                />
              );
            })}
          </ul>
        )}

        <p className="text-sm font-medium">
          Total ·{" "}
          {formatBookingPrice(totals.totalCents + extrasCents, booking.currency)}
          {extrasCents > 0
            ? ` (${formatBookingPrice(
                extrasCents,
                booking.currency,
              )} of it extras)`
            : ""}
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
  components,
  currency,
  days,
  addons,
  offered,
  extras,
  canEdit,
}: {
  slug: string;
  reference: string;
  line: BookingLineItem;
  customers: Pick<Customer, "id" | "full_name" | "email">[];
  products: LineProduct[];
  assets: AssignableAsset[];
  /** The parts a line may book instead of a whole unit. */
  components: AssignableComponent[];
  currency: string;
  /** Length of the hire, for the extras charged per day. */
  days: number;
  /** Every extra in the catalogue, so an archived one still shows its name. */
  addons: Addon[];
  /** The extras on offer for this line's product. */
  offered: Addon[];
  /** The extras this line took. */
  extras: BookingLineAddon[];
  canEdit: boolean;
}) {
  const product = products.find((row) => row.id === line.product_id);
  const asset = assets.find((row) => row.id === line.asset_id);
  const component = components.find((row) => row.id === line.component_id);
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
            {component ? ` · part ${component.name}` : ""}
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

      {extras.length > 0 ? (
        <ul className="space-y-1 pl-3">
          {extras.map((row) => {
            const addon = addons.find(
              (candidate) => candidate.id === row.addon_id,
            );

            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground">
                  + {row.quantity} × {addon?.name ?? "Extra"} ·{" "}
                  {addonPriceLabel(
                    row.unit_price_cents,
                    row.price_kind,
                    currency,
                  )}{" "}
                  = {formatBookingPrice(addonChargeCents(row, days), currency)}
                </span>

                {canEdit ? (
                  <>
                    <form
                      action={updateLineAddon}
                      className="flex items-center gap-1"
                    >
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="reference" value={reference} />
                      <input type="hidden" name="line_addon_id" value={row.id} />
                      <Input
                        name="quantity"
                        type="number"
                        min={1}
                        max={addon?.max_quantity ?? 99}
                        defaultValue={row.quantity}
                        className="h-7 w-14"
                        aria-label={`How many ${addon?.name ?? "extras"}`}
                      />
                      <Button type="submit" size="sm" variant="ghost">
                        Save
                      </Button>
                    </form>

                    <form action={removeLineAddon}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="reference" value={reference} />
                      <input type="hidden" name="line_addon_id" value={row.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Remove extra
                      </Button>
                    </form>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canEdit && offered.length > 0 ? (
        <form action={addLineAddon} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="line_item_id" value={line.id} />

          <label className="min-w-0 flex-1 space-y-1 text-xs">
            <span className="text-muted-foreground">Add an extra</span>
            <select name="addon_id" className={SELECT_CLASSES}>
              {offered.map((addon) => (
                <option key={addon.id} value={addon.id}>
                  {addon.name} —{" "}
                  {addonPriceLabel(
                    addon.price_cents,
                    addon.price_kind,
                    currency,
                  )}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">How many</span>
            <Input
              name="quantity"
              type="number"
              min={1}
              max={Math.max(...offered.map((addon) => addon.max_quantity))}
              defaultValue={1}
              className="h-9 w-16"
            />
          </label>

          <Button type="submit" size="sm" variant="outline">
            Add extra
          </Button>
        </form>
      ) : null}

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssignAssetForm
            slug={slug}
            reference={reference}
            lineItemId={line.id}
            assetId={line.asset_id}
            assets={assets}
          />

          <AssignComponentForm
            slug={slug}
            reference={reference}
            lineItemId={line.id}
            componentId={line.component_id}
            components={components}
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
