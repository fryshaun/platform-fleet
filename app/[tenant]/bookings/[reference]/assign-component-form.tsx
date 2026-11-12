import { Button } from "@/components/ui/button";
import { assignComponent } from "@/lib/actions/bookings";
import type { Tables } from "@/lib/supabase/types";

import { SELECT_CLASSES } from "../../fields";

/** The minimum a part needs to be offered in the picker. */
export type AssignableComponent = Pick<
  Tables<"asset_components">,
  "id" | "name" | "serial" | "asset_id"
>;

/**
 * The part picker on one line.
 *
 * A line may book a single part rather than a whole unit — a spare wheel for the
 * bike on the same booking — which migration 20 added as
 * `booking_line_items.component_id`. Like the unit picker it is its own form, and
 * like the rider picker it is a naming write rather than a reservation: the
 * exclusion constraint that stops two bookings holding one bike is on `asset_id`
 * alone, so a part may be promised twice without the database objecting.
 *
 * The empty option releases it, which is how a line goes back to "just the
 * product".
 */
export function AssignComponentForm({
  slug,
  reference,
  lineItemId,
  componentId,
  components,
}: {
  slug: string;
  reference: string;
  lineItemId: string;
  componentId: string | null;
  components: readonly AssignableComponent[];
}) {
  return (
    <form action={assignComponent} className="flex items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="line_item_id" value={lineItemId} />

      <label className="min-w-0 flex-1 space-y-1 text-xs">
        <span className="text-muted-foreground">Part</span>
        <select
          name="component_id"
          defaultValue={componentId ?? ""}
          className={SELECT_CLASSES}
        >
          <option value="">Whole product</option>
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.name}
              {component.serial ? ` · ${component.serial}` : ""}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" size="sm" variant="outline">
        Save
      </Button>
    </form>
  );
}
