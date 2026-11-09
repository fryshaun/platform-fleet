import type { Tables } from "@/lib/supabase/types";

/**
 * The optional sections a workspace can switch on.
 *
 * A section is a whole area of the app — routes, tables and Server Actions —
 * that a workspace may not need. `companies.enabled_sections` holds the keys a
 * workspace has turned on, an owner or admin edits that list on Settings, and
 * the database asks `has_company_section()` in every policy of the section. So
 * the switch *hides* a section without ever deleting its rows.
 *
 * This module is free of `server-only`, React and database imports so that both
 * Server and Client Components can read the same labels, and so that the icon
 * rail can decide what to render from one list.
 *
 * The switch is deliberately independent of billing: it is a workspace
 * preference, not a paid feature. When plans start to gate sections ("Products
 * from Pro"), the tier check belongs in `isSectionEnabled` here *and* in
 * `has_company_section` in SQL, because RLS — not this file — has the last word.
 */

export const SECTION_KEYS = ["products"] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionDefinition = {
  key: SectionKey;
  /** Label for the rail, the settings checklist and page titles. */
  label: string;
  /**
   * Path segment under `app/[tenant]/`: the section lives at
   * `/{tenant}/{path}`. Also the key the database checks, so the two cannot
   * drift.
   */
  path: SectionKey;
  /** One line, shown next to the toggle in Settings. */
  description: string;
};

export const SECTIONS: Record<SectionKey, SectionDefinition> = {
  products: {
    key: "products",
    label: "Products",
    path: "products",
    description:
      "Catalogue of products and categories, with variants, gallery media and stock.",
  },
};

/** The checklist on Settings → Sections. */
export const SECTION_OPTIONS = SECTION_KEYS.map((key) => ({
  value: key,
  label: SECTIONS[key].label,
  description: SECTIONS[key].description,
}));

export function isSectionKey(value: unknown): value is SectionKey {
  return (
    typeof value === "string" &&
    (SECTION_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Normalises whatever came out of a form: unknown keys are dropped and each key
 * appears once, in `SECTION_KEYS` order.
 *
 * The database accepts any string in `enabled_sections` — an unknown key simply
 * matches no policy — so this is where the list is kept honest.
 */
export function parseSectionKeys(values: readonly string[]): SectionKey[] {
  const seen = new Set<SectionKey>();

  for (const value of values) {
    if (isSectionKey(value)) {
      seen.add(value);
    }
  }

  return SECTION_KEYS.filter((key) => seen.has(key));
}

/** The sections a company row has switched on, in a stable order. */
export function enabledSectionKeys(
  company: Pick<Tables<"companies">, "enabled_sections">,
): SectionKey[] {
  const enabled = new Set(company.enabled_sections);
  return SECTION_KEYS.filter((key) => enabled.has(key));
}

/**
 * The application-level answer to "is this section on?".
 *
 * It mirrors `has_company_section()` in migration 03 on purpose: the database
 * decides whether rows are reachable, and this decides whether the UI offers
 * them at all. A page must never rely on this check alone.
 */
export function isSectionEnabled(
  company: Pick<Tables<"companies">, "enabled_sections">,
  key: SectionKey,
): boolean {
  return company.enabled_sections.includes(key);
}
