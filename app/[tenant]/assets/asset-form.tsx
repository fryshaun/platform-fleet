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
import { createAsset, updateAsset } from "@/lib/actions/assets";
import {
  ASSET_STATUS_OPTIONS,
  type Asset,
} from "@/lib/assets";

import { SELECT_CLASSES, TEXTAREA_CLASSES } from "../fields";

/** The minimum a product needs to be offered in the picker. */
export type AssetProductOption = {
  id: string;
  title: string;
  handle: string;
};

/**
 * The asset editor, used for both "new" and "edit".
 *
 * One component rather than two because the fields are identical and the only
 * differences — which action runs, whether the address is prefilled — are two
 * props. Everything is a plain form posting to a Server Action: the page stays
 * server-rendered and the result arrives as `?ok=` / `?error=`.
 *
 * The product picker only appears when the products section is on. With it off
 * the form still works — a fleet can be recorded before the catalogue exists —
 * and a hidden field carries the current assignment through untouched.
 */
export function AssetForm({
  slug,
  products,
  asset,
}: {
  slug: string;
  products: AssetProductOption[];
  asset?: Asset;
}) {
  const isEdit = Boolean(asset);
  const canAssign = products.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Details" : "New asset"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "What this unit is called, its serial number and the product it fulfils."
            : "Record one physical unit. Add the next one when you have it — units are counted individually, not as a stock number."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={isEdit ? updateAsset : createAsset}
          className="grid gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="slug" value={slug} />
          {asset ? (
            <>
              <input type="hidden" name="asset_id" value={asset.id} />
              <input
                type="hidden"
                name="current_handle"
                value={asset.handle}
              />
            </>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              name="name"
              defaultValue={asset?.name ?? ""}
              placeholder="bike-1"
              required
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-handle">Address</Label>
            <Input
              id="asset-handle"
              name="handle"
              defaultValue={asset?.handle ?? ""}
              placeholder="derived from the name"
              maxLength={50}
            />
            <p className="text-muted-foreground text-xs">
              The last part of the URL. Empty derives it from the name when
              creating, and keeps the current address when editing.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-serial">Serial number</Label>
            <Input
              id="asset-serial"
              name="serial"
              defaultValue={asset?.serial ?? ""}
              maxLength={120}
            />
            <p className="text-muted-foreground text-xs">
              Optional, and unique per workspace when set.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-status">Status</Label>
            <select
              id="asset-status"
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

          {canAssign ? (
            <div className="space-y-2">
              <Label htmlFor="asset-product">Product</Label>
              <select
                id="asset-product"
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
              <p className="text-muted-foreground self-end text-xs sm:col-span-1">
                Switch the products section on to assign this unit to a product.
              </p>
            </>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="asset-notes">Notes</Label>
            <textarea
              id="asset-notes"
              name="notes"
              defaultValue={asset?.notes ?? ""}
              className={TEXTAREA_CLASSES}
            />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit">
              {isEdit ? "Save asset" : "Add asset"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
