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
import { updateInventory } from "@/lib/actions/products";
import { inventoryLabel, type Product } from "@/lib/products";

/**
 * Stock for a product that is counted as a single number.
 *
 * A `dated` product is stocked per window instead, and `DatesSection` owns that,
 * so this component renders nothing for it — one place to look, always.
 */
export function InventorySection({
  slug,
  product,
  canEdit,
}: {
  slug: string;
  product: Product;
  canEdit: boolean;
}) {
  if (product.kind === "dated") {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock</CardTitle>
        <CardDescription>
          {product.track_inventory
            ? `${inventoryLabel(product)} right now.`
            : "This product is not counted. Warehouses that sell made-to-order items usually leave counting off."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <form
            action={updateInventory}
            className="grid gap-3 sm:grid-cols-[8rem_auto_auto] sm:items-end"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="current_handle" value={product.handle} />

            <div className="space-y-2">
              <Label htmlFor="inventory-quantity">On hand</Label>
              <Input
                id="inventory-quantity"
                name="inventory_quantity"
                type="number"
                min={0}
                step={1}
                defaultValue={product.inventory_quantity ?? ""}
                placeholder="—"
              />
            </div>

            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="track_inventory"
                defaultChecked={product.track_inventory}
                className="accent-primary size-4"
              />
              Count this product
            </label>

            <Button type="submit" variant="outline">
              Save stock
            </Button>
          </form>
        ) : (
          <p className="text-sm">{inventoryLabel(product)}</p>
        )}
      </CardContent>
    </Card>
  );
}
