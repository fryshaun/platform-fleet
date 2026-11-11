import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteCategory } from "@/lib/actions/products";
import type { ProductCategory } from "@/lib/products";

import { CategoryFields } from "./category-fields";

/**
 * The aisle list as a deck of cards.
 *
 * Categories have no page of their own — a name, an address and a description
 * are the whole record — so unlike the catalogue and the fleet, a card here is
 * a form rather than a link. Each one is named by its category for the
 * screen-reader landmark list, and the delete button posts to `deleteCategory`
 * from inside the same form with `formAction`, which keeps one row of fields
 * and two buttons without nesting a second `<form>`.
 *
 * Deleting is safe by construction: the composite foreign key sets
 * `products.category_id` back to null, so the count on the card is what the
 * operator loses — the products stay.
 */
export function CategoryDeck({
  slug,
  categories,
  counts,
}: {
  slug: string;
  categories: ProductCategory[];
  /** Products per category id; missing means an empty aisle. */
  counts: Map<string, number>;
}) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {categories.map((category) => (
        <li key={category.id}>
          <CategoryCard
            slug={slug}
            category={category}
            productCount={counts.get(category.id) ?? 0}
          />
        </li>
      ))}
    </ul>
  );
}

function CategoryCard({
  slug,
  category,
  productCount,
}: {
  slug: string;
  category: ProductCategory;
  productCount: number;
}) {
  return (
    <article
      aria-label={category.name}
      className="bg-card text-card-foreground focus-within:ring-ring/50 flex h-full flex-col gap-3 rounded-xl border p-4 shadow-sm focus-within:ring-[3px]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground truncate text-xs">
          /{category.handle}
        </p>
        <span className="text-muted-foreground shrink-0 text-xs">
          {productCount} product{productCount === 1 ? "" : "s"}
        </span>
      </div>

      <CategoryFields
        slug={slug}
        category={category}
        formId={`category-${category.id}`}
        submitLabel="Save"
        actions={
          <Button
            type="submit"
            formAction={deleteCategory}
            formNoValidate
            size="sm"
            variant="ghost"
            aria-label={`Delete ${category.name}`}
          >
            <Trash2Icon aria-hidden="true" />
            Delete
          </Button>
        }
      />
    </article>
  );
}
