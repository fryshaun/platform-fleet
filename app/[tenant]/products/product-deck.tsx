import { PackageIcon } from "lucide-react";
import Link from "next/link";

import type { ProductImage } from "@/lib/product-media";
import { familyPriceLabel, type ProductFamily } from "@/lib/products";

import { ProductStatusBadge, StockBadge } from "./product-badges";

/**
 * The catalogue as a deck of cards.
 *
 * One card per product family — the parents in the list, with their variants
 * counted rather than listed, because a card is a shelf label and not a table of
 * contents. The picture is the parent's own, falling back to the first variant
 * that has one: a "beans" family whose photos only live on the 1kg variant
 * should still look like beans.
 *
 * As on the fleet, the title carries `after:absolute after:inset-0` so the whole
 * card is clickable without wrapping the badges and the image in the link's
 * accessible name.
 */
export function ProductDeck({
  slug,
  families,
  images,
}: {
  slug: string;
  families: ProductFamily[];
  images: Map<string, ProductImage>;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {families.map((family) => (
        <li key={family.parent.id}>
          <ProductCard
            slug={slug}
            family={family}
            image={familyImage(family, images)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The parent's image, or the first one any of its variants has. */
function familyImage(
  family: ProductFamily,
  images: Map<string, ProductImage>,
): ProductImage | undefined {
  const own = images.get(family.parent.id);
  if (own) return own;

  for (const variant of family.variants) {
    const image = images.get(variant.id);
    if (image) return image;
  }

  return undefined;
}

function ProductCard({
  slug,
  family,
  image,
}: {
  slug: string;
  family: ProductFamily;
  image?: ProductImage;
}) {
  const { parent, variants } = family;

  return (
    <article className="bg-card text-card-foreground group relative flex h-full flex-col overflow-hidden rounded-xl border shadow-sm transition-shadow focus-within:ring-ring/50 hover:shadow-md focus-within:ring-[3px]">
      <div className="bg-muted relative aspect-[4/3] overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- public Storage URL, not an optimizable local asset
          <img
            src={image.url}
            alt={image.alt ?? parent.title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="text-muted-foreground/70 flex size-full flex-col items-center justify-center gap-1.5">
            <PackageIcon aria-hidden="true" className="size-7" />
            <span className="text-xs">No image yet</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-sm font-semibold">
              <Link
                href={`/${slug}/products/${parent.handle}`}
                className="underline-offset-4 outline-none after:absolute after:inset-0 group-hover:underline focus-visible:underline"
              >
                {parent.title}
              </Link>
            </h2>
            <p className="text-muted-foreground truncate text-xs">
              /{parent.handle}
            </p>
          </div>
          <ProductStatusBadge status={parent.status} />
        </div>

        <p className="pt-1 text-sm font-medium">{familyPriceLabel(family)}</p>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <StockBadge product={parent} />
          <span className="text-muted-foreground text-xs">
            {variants.length === 0
              ? "No variants"
              : `${variants.length} variant${variants.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
    </article>
  );
}
