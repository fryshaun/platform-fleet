import "server-only";

import { PRODUCT_MEDIA_BUCKET } from "@/lib/products";
import type { createClient } from "@/lib/supabase/server";

/**
 * The first image of a product, as a card needs it.
 *
 * `url` is always a plain URL: rows either point at an upload in the public
 * `product-media` bucket or at a link stored elsewhere, and both resolve the
 * same way here — which is why cards can use `<img>` instead of the image
 * optimiser.
 */
export type ProductImage = {
  url: string;
  alt: string | null;
};

type MediaClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The first image of every product in a list, keyed by product id.
 *
 * One query for the whole page, then the lowest-position row per product wins,
 * so the number of requests does not grow with the catalogue. Ids that are
 * absent (an asset with no product, a version of the page with no rows) are
 * filtered out before the query, because `in ()` with an empty list would fetch
 * everything.
 */
export async function firstImagePerProduct(
  supabase: MediaClient,
  companyId: string,
  productIds: readonly (string | null | undefined)[],
): Promise<Map<string, ProductImage>> {
  const images = new Map<string, ProductImage>();

  const wanted = [
    ...new Set(productIds.filter((id): id is string => Boolean(id))),
  ];
  if (wanted.length === 0) {
    return images;
  }

  const { data: mediaRows } = await supabase
    .from("product_media")
    .select("product_id, storage_path, url, alt")
    .eq("company_id", companyId)
    .in("product_id", wanted)
    .eq("kind", "image")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  for (const row of mediaRows ?? []) {
    if (images.has(row.product_id)) continue;

    const url =
      row.url ??
      (row.storage_path
        ? supabase.storage
            .from(PRODUCT_MEDIA_BUCKET)
            .getPublicUrl(row.storage_path).data.publicUrl
        : null);

    if (url) {
      images.set(row.product_id, { url, alt: row.alt });
    }
  }

  return images;
}
