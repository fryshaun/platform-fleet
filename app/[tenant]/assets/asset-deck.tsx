import { PackageIcon } from "lucide-react";
import Link from "next/link";

import type { Asset } from "@/lib/assets";
import type { ProductImage } from "@/lib/product-media";

import { AssetStatusBadge } from "./asset-badges";

/**
 * The fleet as a deck of cards.
 *
 * Each card is one unit: the product's image on top, then the name, its address,
 * its serial number and the status pill. The whole card is the link — the title
 * carries `after:absolute after:inset-0`, which stretches its hit area over the
 * card without wrapping the badge and the image in a link that screen readers
 * would read as one long label.
 */
export function AssetDeck({
  slug,
  assets,
  images,
  productTitles,
}: {
  slug: string;
  assets: Asset[];
  images: Map<string, ProductImage>;
  productTitles: Map<string, string>;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset) => (
        <li key={asset.id}>
          <AssetCard
            slug={slug}
            asset={asset}
            image={asset.product_id ? images.get(asset.product_id) : undefined}
            productTitle={
              asset.product_id ? productTitles.get(asset.product_id) : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}

function AssetCard({
  slug,
  asset,
  image,
  productTitle,
}: {
  slug: string;
  asset: Asset;
  image?: ProductImage;
  productTitle?: string;
}) {
  return (
    <article className="bg-card text-card-foreground group relative flex h-full flex-col overflow-hidden rounded-xl border shadow-sm transition-shadow focus-within:ring-ring/50 hover:shadow-md focus-within:ring-[3px]">
      <div className="bg-muted relative aspect-[4/3] overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- public Storage URL, not an optimizable local asset
          <img
            src={image.url}
            alt={image.alt ?? productTitle ?? asset.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="text-muted-foreground/70 flex size-full flex-col items-center justify-center gap-1.5">
            <PackageIcon aria-hidden="true" className="size-7" />
            <span className="text-xs">
              {productTitle ? "No product image" : "Not assigned to a product"}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-sm font-semibold">
              <Link
                href={`/${slug}/assets/${asset.handle}`}
                className="underline-offset-4 outline-none after:absolute after:inset-0 group-hover:underline focus-visible:underline"
              >
                {asset.name}
              </Link>
            </h2>
            <p className="text-muted-foreground truncate text-xs">
              /{asset.handle}
            </p>
          </div>
          <AssetStatusBadge status={asset.status} />
        </div>

        <p className="text-muted-foreground truncate text-xs">
          {asset.serial ? `Serial ${asset.serial}` : "No serial number"}
        </p>

        {productTitle ? (
          <p className="text-muted-foreground mt-auto truncate pt-2 text-xs">
            {productTitle}
          </p>
        ) : null}
      </div>
    </article>
  );
}
