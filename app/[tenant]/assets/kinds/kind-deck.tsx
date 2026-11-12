import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteComponentKind } from "@/lib/actions/asset-components";
import { type ComponentKind, describeInterval } from "@/lib/components";

import { KindFields } from "./kind-fields";

/**
 * The taxonomy as a deck of cards.
 *
 * A kind is a name, an address, an order and three intervals — nothing worth a
 * page of its own — so like the categories deck, a card *is* the form. The part
 * count on the card is the reason the delete button is safe: the database sets
 * `asset_components.kind_id` back to null, so deleting a kind leaves the parts
 * behind, unclassified, and the count is what the operator gives up.
 */
export function KindDeck({
  slug,
  kinds,
  counts,
}: {
  slug: string;
  kinds: ComponentKind[];
  /** Components per kind id; missing means nothing is filed under it. */
  counts: Map<string, number>;
}) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {kinds.map((kind) => (
        <li key={kind.id}>
          <KindCard
            slug={slug}
            kind={kind}
            componentCount={counts.get(kind.id) ?? 0}
          />
        </li>
      ))}
    </ul>
  );
}

function KindCard({
  slug,
  kind,
  componentCount,
}: {
  slug: string;
  kind: ComponentKind;
  componentCount: number;
}) {
  return (
    <article
      aria-label={kind.name}
      className="bg-card text-card-foreground focus-within:ring-ring/50 flex h-full flex-col gap-3 rounded-xl border p-4 shadow-sm focus-within:ring-[3px]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground truncate text-xs">/{kind.handle}</p>
        <span className="text-muted-foreground shrink-0 text-xs">
          {componentCount} part{componentCount === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-sm">{describeInterval(kind)}</p>

      <KindFields
        slug={slug}
        kind={kind}
        formId={`kind-${kind.id}`}
        submitLabel="Save"
        actions={
          <Button
            type="submit"
            formAction={deleteComponentKind}
            formNoValidate
            size="sm"
            variant="ghost"
            aria-label={`Delete ${kind.name}`}
          >
            <Trash2Icon aria-hidden="true" />
            Delete
          </Button>
        }
      />
    </article>
  );
}
