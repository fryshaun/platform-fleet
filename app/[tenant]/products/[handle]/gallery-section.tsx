import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMediaLink, removeProductMedia } from "@/lib/actions/products";
import type { ProductMediaKind } from "@/lib/supabase/types";

import { SELECT_CLASSES } from "../../fields";
import { GalleryUploader } from "./gallery-uploader";

export type GalleryItem = {
  id: string;
  kind: ProductMediaKind;
  /** Resolved public URL, or the external link the row stores. */
  url: string | null;
  alt: string | null;
};

/**
 * The gallery: existing media first, then the two ways to add more.
 *
 * Rows are the source of truth; this only renders them. Objects live in the
 * public `product-media` bucket, which is why a plain `<img>` is enough — the
 * optimizer in `next/image` would need the Supabase host in `next.config.ts`,
 * and that host is per-deployment.
 */
export function GallerySection({
  slug,
  productId,
  handle,
  items,
  canEdit,
}: {
  slug: string;
  productId: string;
  handle: string;
  items: GalleryItem[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gallery</CardTitle>
        <CardDescription>
          Images and video a storefront can show. The first item is the one a
          listing usually leads with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing in the gallery yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="bg-muted/40 flex flex-col gap-2 rounded-xl border p-2"
              >
                <div className="bg-background flex aspect-square items-center justify-center overflow-hidden rounded-lg">
                  {item.url ? (
                    item.kind === "video" ? (
                      <video
                        src={item.url}
                        controls
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- public Storage URL, not an optimizable local asset
                      <img
                        src={item.url}
                        alt={item.alt ?? ""}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      No preview
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground truncate text-xs">
                    {item.alt ?? item.kind}
                  </span>

                  {canEdit ? (
                    <form action={removeProductMedia}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="current_handle" value={handle} />
                      <input type="hidden" name="media_id" value={item.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        <Trash2Icon aria-hidden="true" />
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="grid gap-6 border-t pt-6 sm:grid-cols-2">
            <GalleryUploader slug={slug} productId={productId} />

            <form action={addMediaLink} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="product_id" value={productId} />
              <input type="hidden" name="current_handle" value={handle} />

              <div className="space-y-2">
                <Label htmlFor="gallery-url">Or link to media elsewhere</Label>
                <Input
                  id="gallery-url"
                  name="url"
                  type="url"
                  placeholder="https://…"
                  maxLength={500}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <select
                  name="kind"
                  aria-label="Media type"
                  defaultValue="image"
                  className={SELECT_CLASSES}
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
                <Input
                  name="alt"
                  aria-label="Alternative text"
                  placeholder="Describe it (optional)"
                  maxLength={200}
                />
              </div>

              <Button type="submit" size="sm" variant="outline">
                Add link
              </Button>
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
