import { Button } from "@/components/ui/button";
import { assignAsset } from "@/lib/actions/bookings";
import type { Tables } from "@/lib/supabase/types";

import { SELECT_CLASSES } from "../../fields";

/** The minimum a unit needs to be offered in the picker. */
export type AssignableAsset = Pick<Tables<"assets">, "id" | "name" | "status">;

/**
 * The unit picker on one line.
 *
 * Its own form, because it is its own write: allocating a unit is the change the
 * desk makes most often, and it must not need the rest of the line — or the
 * product — to happen. The empty option releases the unit, which is how a
 * booking goes back to "we will decide which bike on the morning".
 *
 * The status is shown beside each name rather than used to filter the list: a
 * unit that is out of action is still the one this booking is for, and hiding it
 * would make the line look unallocated.
 */
export function AssignAssetForm({
  slug,
  reference,
  lineItemId,
  assetId,
  assets,
}: {
  slug: string;
  reference: string;
  lineItemId: string;
  assetId: string | null;
  assets: AssignableAsset[];
}) {
  return (
    <form action={assignAsset} className="flex items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="line_item_id" value={lineItemId} />

      <label className="min-w-0 flex-1 space-y-1 text-xs">
        <span className="text-muted-foreground">Unit</span>
        <select
          name="asset_id"
          defaultValue={assetId ?? ""}
          className={SELECT_CLASSES}
        >
          <option value="">Not allocated</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
              {asset.status === "available" ? "" : ` (${asset.status})`}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" size="sm" variant="outline">
        Assign
      </Button>
    </form>
  );
}
