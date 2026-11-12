import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deleteAddon, setAddonStatus } from "@/lib/actions/addons";
import {
  ADDON_STATUS_LABELS,
  addonPriceLabel,
  addonScopeByAddon,
  type Addon,
  type AddonProduct,
} from "@/lib/addons";

import { AddonFields, type ScopeProduct } from "./addon-fields";

/**
 * The catalogue, one card per extra.
 *
 * A card is a form, the same shape the category deck uses: the fields post to
 * `updateAddon`, and the two buttons beside Save reach a different action through
 * `formAction` rather than nesting a second `<form>` inside the first.
 *
 * Archiving is offered *beside* deletion rather than instead of it: a catalogue
 * row nobody has hired can simply go, while one that appears on a booking cannot
 * — the foreign key refuses, and the message on the page says to archive instead.
 */
export function AddonDeck({
  slug,
  addons,
  scope,
  products,
  currency,
  canEdit,
}: {
  slug: string;
  addons: Addon[];
  scope: AddonProduct[];
  products: ScopeProduct[];
  currency: string;
  canEdit: boolean;
}) {
  const scopeByAddon = addonScopeByAddon(scope);

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {addons.map((addon) => {
        const archived = addon.status === "archived";
        const scopedTo = products.filter((product) =>
          (scopeByAddon.get(addon.id) ?? []).includes(product.id),
        );

        return (
          <li key={addon.id}>
            <Card className={archived ? "opacity-70" : undefined}>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{addon.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {addonPriceLabel(
                        addon.price_cents,
                        addon.price_kind,
                        currency,
                      )}
                      {" · "}
                      {addon.max_quantity === 1
                        ? "one per line"
                        : `up to ${addon.max_quantity} per line`}
                      {" · "}
                      {scopedTo.length === 0
                        ? "every product"
                        : scopedTo.map((product) => product.title).join(", ")}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {ADDON_STATUS_LABELS[addon.status]}
                  </span>
                </div>

                {canEdit ? (
                  <AddonFields
                    slug={slug}
                    addon={addon}
                    products={products}
                    scopedProductIds={scopeByAddon.get(addon.id) ?? []}
                    actions={
                      <>
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          formAction={setAddonStatus}
                          name="status"
                          value={archived ? "active" : "archived"}
                        >
                          {archived ? "Put back on offer" : "Archive"}
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          formAction={deleteAddon}
                        >
                          Delete
                        </Button>
                      </>
                    }
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {addon.description ?? "A manager can change this extra."}
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
