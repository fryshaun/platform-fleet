import { TabNav } from "@/components/tenant/tab-nav";
import { SETTINGS_TABS, settingsPath, type SettingsTab } from "@/lib/settings";

/** The tab strip shared by every settings screen. */
export function SettingsTabs({
  slug,
  current,
}: {
  slug: string;
  current: SettingsTab;
}) {
  return (
    <TabNav
      label="Settings"
      current={settingsPath(slug, current)}
      items={SETTINGS_TABS.map((entry) => ({
        href: settingsPath(slug, entry.tab),
        label: entry.label,
      }))}
    />
  );
}
