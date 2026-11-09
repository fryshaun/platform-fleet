import { Badge } from "@/components/ui/badge";
import {
  inventoryLabel,
  isLowStock,
  PRODUCT_STATUS_LABELS,
  type Product,
} from "@/lib/products";
import type { ProductStatus } from "@/lib/supabase/types";

/** The status pill shared by the list and the product page. */
export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant={status === "active" ? "secondary" : "outline"}>
      {PRODUCT_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Stock pill. A counted item at or below `LOW_STOCK_THRESHOLD` is red; anything
 * the shop does not count says so instead of showing a misleading zero.
 */
export function StockBadge({
  product,
}: {
  product: Pick<Product, "kind" | "track_inventory" | "inventory_quantity">;
}) {
  return (
    <Badge variant={isLowStock(product) ? "destructive" : "outline"}>
      {inventoryLabel(product)}
    </Badge>
  );
}
