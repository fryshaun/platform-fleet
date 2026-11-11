import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  assetStatusLabel,
  availabilityLabel,
  summariseAssets,
  type Asset,
} from "@/lib/assets";

/**
 * The units of this product that the assets section knows about.
 *
 * One-directional and optional: this card is only rendered when the workspace
 * has the assets section switched on, and the assets section never requires the
 * products section. Nothing here is written — availability is derived from the
 * rows on every render, so the number cannot drift from the list under it.
 */
export function AssetsSection({
  slug,
  assets,
}: {
  slug: string;
  assets: readonly Asset[];
}) {
  const { total, outOfService, retired } = summariseAssets(assets);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assets</CardTitle>
        <CardDescription>
          {total === 0
            ? "No units are assigned to this product yet."
            : `${availabilityLabel(assets)}${
                outOfService > 0 ? ` · ${outOfService} out of action` : ""
              }${retired > 0 ? ` · ${retired} retired` : ""}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Link
              href={`/${slug}/assets`}
              className="text-foreground underline underline-offset-4"
            >
              Record a unit
            </Link>{" "}
            to count the individual bikes, boats or rooms this product is sold
            as.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/${slug}/assets/${asset.handle}`}
                    className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {asset.name}
                  </Link>
                  {asset.serial ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {asset.serial}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={
                    asset.status === "available"
                      ? "brand"
                      : asset.status === "maintenance"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {assetStatusLabel(asset.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" size="sm" asChild>
          <Link href={`/${slug}/assets`}>Manage assets</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
