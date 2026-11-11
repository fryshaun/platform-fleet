import { PageHeader } from "@/components/tenant/page-header";
import type { SettingsTab } from "@/lib/settings";

import { SettingsTabs } from "./settings-tabs";

/**
 * Title, one-line description and the tab strip.
 *
 * Every tab renders this first, so the strip cannot drift between screens and
 * the width stays the same while switching — a strip that jumps is how a tab
 * bar starts to feel like separate pages glued together.
 */
export function SettingsHeader({
  slug,
  current,
  description,
}: {
  slug: string;
  current: SettingsTab;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description={description} />
      <SettingsTabs slug={slug} current={current} />
    </div>
  );
}
