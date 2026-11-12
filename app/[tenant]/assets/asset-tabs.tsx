import { TabNav } from "@/components/tenant/tab-nav";
import { ASSET_TABS, assetTabPath, type AssetTab } from "@/lib/assets";

/** The tab strip shared by every screen of a unit. */
export function AssetTabs({
  slug,
  handle,
  current,
}: {
  slug: string;
  handle: string;
  current: AssetTab;
}) {
  return (
    <TabNav
      label="Asset"
      current={assetTabPath(slug, handle, current)}
      items={ASSET_TABS.map((entry) => ({
        href: assetTabPath(slug, handle, entry.tab),
        label: entry.label,
      }))}
    />
  );
}
