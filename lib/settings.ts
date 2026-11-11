/**
 * Where the settings screens live.
 *
 * Settings is one screen split into tabs, and every tab is a real URL: the
 * screens stay server-rendered, a link to "Team" means something, and the back
 * button moves between tabs. This module is the only place that knows the
 * order, the labels and the paths, so the tab strip, the rail's gear and every
 * redirect agree by construction.
 *
 * Company is the index (`/settings`) — it is what a link written before this
 * split already points at, and it is where the gear lands.
 *
 * Framework-free, like `lib/features.ts`, so Server and Client Components read
 * the same labels.
 */

export type SettingsTab =
  | "company"
  | "extensions"
  | "security"
  | "team"
  | "billing";

export type SettingsTabDefinition = {
  tab: SettingsTab;
  /** Label in the tab strip and the page title. */
  label: string;
  /** Path segment under `settings/`; empty for the index tab. */
  segment: string;
};

export const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
  { tab: "company", label: "Company", segment: "" },
  { tab: "extensions", label: "Extensions", segment: "extensions" },
  { tab: "security", label: "Security", segment: "security" },
  { tab: "team", label: "Team", segment: "team" },
  { tab: "billing", label: "Billing", segment: "billing" },
];

/** `/{slug}/settings` for Company, `/{slug}/settings/team` for Team, … */
export function settingsPath(slug: string, tab: SettingsTab): string {
  return `/${slug}/${settingsSegment(tab)}`;
}

/**
 * The part of the path after the workspace slug.
 *
 * Shaped like the `path` argument of `redirectWith`, which prepends `/{slug}/`,
 * so a Server Action names a tab instead of spelling the URL out — a typo then
 * fails to compile rather than landing on a 404.
 */
export function settingsSegment(tab: SettingsTab): string {
  const definition = SETTINGS_TABS.find((entry) => entry.tab === tab);
  return definition?.segment ? `settings/${definition.segment}` : "settings";
}
