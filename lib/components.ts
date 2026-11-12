import { isIsoDate } from "@/lib/products";
import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import type { Tables } from "@/lib/supabase/types";

/**
 * Component rules shared by the fleet pages, the Server Actions and the tests.
 *
 * Like `lib/assets.ts` this module is free of `server-only` and of any database
 * import. Authorization is in the Server Actions and in RLS.
 *
 * The three rules worth stating once:
 *
 *   1. A component is *fitted* while `removed_on` is null. Removing it sets a
 *      date and keeps the row — the service history is the reason it exists.
 *   2. The fitted window is half-open, `[fitted_on, removed_on)`, like every
 *      other window in this schema.
 *   3. One unit may hold one component of a kind at a time. The database states
 *      it as a partial unique index, so two forks on one bike is impossible even
 *      if two people type at once.
 */

export type ComponentKind = Tables<"component_kinds">;
export type AssetComponent = Tables<"asset_components">;

// -----------------------------------------------------------------------------
// Kinds
// -----------------------------------------------------------------------------
export const RESERVED_KIND_HANDLES = new Set(["new"]);

/** Explains what is wrong with a kind's handle, or `null` when it is usable. */
export function kindHandleProblem(handle: string): string | null {
  if (RESERVED_KIND_HANDLES.has(handle)) {
    return "That address is reserved by the section. Please pick another.";
  }
  if (handle.length === 0) {
    return "Enter an address for the kind.";
  }

  const problem = validateSlug(handle);
  return problem ? SLUG_PROBLEM_MESSAGES[problem] : null;
}

/** Turns a kind's name into a handle, the same way a category's is derived. */
export function deriveKindHandle(name: string): string {
  return slugify(name);
}

/** Mirrors `length(trim(name)) between 1 and 80` in the database. */
export function kindNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the kind a name, for example Fork.";
  if (trimmed.length > 80) return "Keep the name under 80 characters.";
  return null;
}

/** A kind, as the taxonomy form submits it. */
export type ComponentKindDraft = {
  name: string;
  handle: string;
  position: number;
};

/** Reads and validates a taxonomy row. */
export function parseComponentKindDraft(
  formData: FormData,
): { draft: ComponentKindDraft } | { error: string } {
  const name = field(formData, "name");
  const nameProblem = kindNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  const handle =
    field(formData, "handle") ||
    field(formData, "current_handle") ||
    deriveKindHandle(name);
  const handleProblem = kindHandleProblem(handle);
  if (handleProblem) {
    return { error: handleProblem };
  }

  const position = Number.parseInt(field(formData, "position") || "0", 10);
  if (!Number.isInteger(position) || position < 0) {
    return { error: "Order is a whole number, 0 or more." };
  }

  return { draft: { name, handle, position } };
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------
/** Mirrors `length(trim(name)) between 1 and 120` in the database. */
export function componentNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Give the component a name, for example Fox 36.";
  }
  if (trimmed.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/** Mirrors the serial-length CHECK; an absent serial is fine. */
export function componentSerialProblem(serial: string): string | null {
  if (serial.trim().length > 120) {
    return "Keep the serial number under 120 characters.";
  }
  return null;
}

/**
 * Explains what is wrong with a fitted window, or `null`.
 *
 * Half-open: a part fitted and removed on the same day was never fitted, so
 * `removed_on` must be strictly later. An empty `removed_on` means "still
 * fitted" and is always legal.
 */
export function fittedWindowProblem(
  fittedOn: string,
  removedOn: string,
): string | null {
  if (!isIsoDate(fittedOn)) {
    return "Choose the day the part was fitted.";
  }
  if (removedOn === "") return null;
  if (!isIsoDate(removedOn)) {
    return "Choose the day the part came off, or leave it blank.";
  }
  if (removedOn <= fittedOn) {
    return "A part cannot come off on or before the day it was fitted.";
  }
  return null;
}

/** True while the component is fitted to a unit. */
export function isFitted(
  component: Pick<AssetComponent, "asset_id" | "removed_on">,
): boolean {
  return component.asset_id !== null && component.removed_on === null;
}

/** Where a component is, in the words the page uses. */
export function componentWhereLabel(
  component: Pick<AssetComponent, "asset_id" | "removed_on">,
  assetName: string | undefined,
): string {
  if (component.removed_on !== null) return "Removed";
  if (component.asset_id === null) return "In the parts bin";
  return `Fitted to ${assetName ?? "a unit"}`;
}

/** The components on one unit, fitted ones first, newest fitting first. */
export function componentsForAsset(
  components: readonly AssetComponent[],
  assetId: string,
): AssetComponent[] {
  return components
    .filter((component) => component.asset_id === assetId)
    .sort((a, b) => {
      if (isFitted(a) !== isFitted(b)) return isFitted(a) ? -1 : 1;
      return b.fitted_on.localeCompare(a.fitted_on);
    });
}

/** A component, as the form submits it. */
export type ComponentDraft = {
  name: string;
  serial: string | null;
  kind_id: string | null;
  asset_id: string | null;
  fitted_on: string;
  removed_on: string | null;
  notes: string | null;
};

/** Reads and validates a component. */
export function parseComponentDraft(
  formData: FormData,
): { draft: ComponentDraft } | { error: string } {
  const name = field(formData, "name");
  const nameProblem = componentNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  const serial = field(formData, "serial");
  const serialProblem = componentSerialProblem(serial);
  if (serialProblem) {
    return { error: serialProblem };
  }

  const fittedOn = field(formData, "fitted_on");
  const removedOn = field(formData, "removed_on");
  const windowProblem = fittedWindowProblem(fittedOn, removedOn);
  if (windowProblem) {
    return { error: windowProblem };
  }

  return {
    draft: {
      name,
      serial: serial || null,
      kind_id: field(formData, "kind_id") || null,
      asset_id: field(formData, "asset_id") || null,
      fitted_on: fittedOn,
      removed_on: removedOn || null,
      notes: field(formData, "notes") || null,
    },
  };
}

/** Reads a trimmed form field, treating empty values as absent. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
