import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Asset } from "@/lib/assets";

import { AssetFields, type AssetProductOption } from "./asset-fields";

export type { AssetProductOption };

/**
 * The asset editor card, used for editing a unit on its own page.
 *
 * Creating one happens in the slideout on the index
 * (`components/tenant/form-sheet.tsx`), which is the same field set; this card
 * is what "Details" looks like once the unit exists. Everything is a plain form
 * posting to a Server Action: the page stays server-rendered and the result
 * arrives as `?ok=` / `?error=`.
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
        <AssetFields slug={slug} products={products} asset={asset} />
      </CardContent>
    </Card>
  );
}

