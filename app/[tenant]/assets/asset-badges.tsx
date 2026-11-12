import { Badge } from "@/components/ui/badge";
import {
  assetStatusLabel,
  availabilityLabel,
  isAssetAvailable,
  summariseAssets,
  type Asset,
} from "@/lib/assets";
import type { AssetStatus } from "@/lib/supabase/types";

/**
 * The status pill shared by the list and the asset page.
 *
 * "Available" is the quiet state a fleet is normally in, so only the states that
 * need a decision — out of action, retired — get a louder badge. `rented` is
 * neither: the unit is working, it is simply out with a customer, so it gets a
 * filled but quiet pill that reads as a fact rather than a problem.
 */
export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return (
    <Badge
      variant={
        status === "available"
          ? "brand"
          : status === "in_workshop"
            ? "destructive"
            : status === "rented"
              ? "secondary"
              : "outline"
      }
    >
      {assetStatusLabel(status)}
    </Badge>
  );
}

/**
 * "2 of 3 available" as a pill, for the cards that summarise a product's fleet.
 *
 * The count is derived from the rows every render (`lib/assets.ts`) — nothing
 * stores it — so it cannot disagree with the list underneath.
 */
export function AvailabilityBadge({
  assets,
}: {
  assets: readonly Pick<Asset, "status">[];
}) {
  const { total, available } = summariseAssets(assets);

  return (
    <Badge variant={total > 0 && available === 0 ? "destructive" : "outline"}>
      {availabilityLabel(assets)}
    </Badge>
  );
}

/** Whether a single unit can be booked right now, in one word. */
export function AssetAvailabilityBadge({
  asset,
}: {
  asset: Pick<Asset, "status">;
}) {
  return (
    <Badge variant={isAssetAvailable(asset) ? "brand" : "outline"}>
      {isAssetAvailable(asset) ? "Bookable" : "Not bookable"}
    </Badge>
  );
}
