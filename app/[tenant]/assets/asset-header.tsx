import Link from "next/link";

import { PageHeader } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { type Asset, type AssetTab, assetStatusLabel } from "@/lib/assets";

import { AssetAvailabilityBadge, AssetStatusBadge } from "./asset-badges";
import { AssetTabs } from "./asset-tabs";

/**
 * Title, the unit's identifying line, its badges and the tab strip.
 *
 * Every tab renders this first, so the strip cannot drift between screens and
 * the width stays the same while switching — a strip that jumps is how a tab
 * bar starts to feel like separate pages glued together. The badges live here
 * too: whether a unit is out on hire is a fact about the unit, not about the tab
 * that happens to be open.
 */
export function AssetHeader({
  slug,
  asset,
  current,
}: {
  slug: string;
  asset: Asset;
  current: AssetTab;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={asset.name}
        description={
          <>
            <span className="font-mono">/{asset.handle}</span>
            {" · "}
            {assetStatusLabel(asset.status)}
            {asset.serial ? (
              <>
                {" · "}
                <span className="font-mono">{asset.serial}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${slug}/assets`}>All assets</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <AssetStatusBadge status={asset.status} />
        <AssetAvailabilityBadge asset={asset} />
      </div>

      <AssetTabs slug={slug} handle={asset.handle} current={current} />
    </div>
  );
}
