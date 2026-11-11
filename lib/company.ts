import { initials } from "@/lib/account";
import {
  IMAGE_ACCEPT,
  IMAGE_TYPES,
  imageTypeFor,
  isImagePathIn,
  publicObjectPath,
  type ImageType,
} from "@/lib/uploads";

/**
 * Rules for a workspace's identity — the square in the rail, and the currency its
 * products start in.
 *
 * Framework-free and free of `server-only`, like `lib/account.ts`, so the settings
 * screen can enforce the same limits the Server Action does. The action stays the
 * authority; the browser copy only fails fast.
 */

/**
 * How much a badge may hold, counted in *graphemes* rather than code units: one
 * emoji is one character even when it is built from several code points (a flag,
 * a rocket with a skin tone, a family joined by zero-width joiners).
 *
 * Two is the whole point: `AB` for two words, `A` for one, `🎾` for a shop that
 * would rather not be initialled at all.
 */
export const COMPANY_BADGE_MAX = 2;

/** Splits text the way a reader counts it, falling back on older engines. */
function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter().segment(value), (entry) => entry.segment);
  }
  return [...value];
}

/**
 * Trims a badge and turns "nothing" into `null`.
 *
 * Null is not the same as empty: it is the signal for "draw the initials of the
 * name instead", which is what a workspace that never set one should get.
 */
export function companyBadge(value: string): string | null {
  const badge = value.trim();
  return badge === "" ? null : badge;
}

/** The problem with a badge, or `null` when it is acceptable. */
export function companyBadgeProblem(value: string): string | null {
  const badge = value.trim();
  if (badge === "") {
    return null;
  }
  if (/\s/.test(badge)) {
    return "Use one or two characters, or a single emoji.";
  }
  if (graphemes(badge).length > COMPANY_BADGE_MAX) {
    return `Keep the badge to ${COMPANY_BADGE_MAX} characters.`;
  }
  return null;
}

/**
 * What the square shows: the badge when there is one, otherwise the initials of
 * the name. Never blank, because `initials` answers "?" for a missing name.
 */
export function companyMark(name: string, badge: string | null): string {
  return companyBadge(badge ?? "") ?? initials(name);
}

// -----------------------------------------------------------------------------
// Logo storage
// -----------------------------------------------------------------------------
/** The Storage bucket every workspace mark lives in. */
export const COMPANY_LOGOS_BUCKET = "company-logos";

/** Mirrors `file_size_limit` on the bucket. */
export const COMPANY_LOGO_MAX_BYTES = 2_097_152;

export type CompanyLogoType = ImageType;

/** Mirrors `allowed_mime_types` on the bucket. */
export const COMPANY_LOGO_TYPES: readonly CompanyLogoType[] = IMAGE_TYPES;

/** The `accept` attribute of the logo input. */
export const COMPANY_LOGO_ACCEPT = IMAGE_ACCEPT;

export function companyLogoTypeFor(mime: string): CompanyLogoType | null {
  return imageTypeFor(mime);
}

/**
 * `<company>/<file>` — the layout the storage policies in migration 06 parse to
 * decide who may write.
 */
export function companyLogoPath(companyId: string, file: string): string {
  return `${companyId}/${file}`;
}

/**
 * Whether a path is one this company could have been handed: its own folder, one
 * file, one of the four extensions.
 *
 * `setCompanyLogo` re-checks it, so a modified client cannot point
 * `companies.logo_url` at another workspace's object.
 */
export function isCompanyLogoPath(path: string, companyId: string): boolean {
  return isImagePathIn(path, companyId, COMPANY_LOGO_TYPES);
}

/**
 * The object path behind one of our own logo URLs, or `null` — used to delete the
 * mark a workspace just replaced, and to leave a pasted URL alone.
 */
export function companyLogoStoragePath(url: string | null): string | null {
  return publicObjectPath(url, COMPANY_LOGOS_BUCKET);
}
