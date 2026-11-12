"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  redirectWith,
  requireFrontDesk,
  requireManager,
  requireSection,
  requireWritableWorkspace,
} from "@/lib/actions/support";
import { assetTabSegment } from "@/lib/assets";
import { parseComponentDraft, parseComponentKindDraft } from "@/lib/components";

/**
 * Writes for the fleet's components and their taxonomy.
 *
 * Two halves, two tiers: naming a *kind* is shop management, like a category,
 * while fitting and removing a part is workshop work and belongs to the front
 * desk. That is the same split migration 18's policies make.
 *
 * Components live under the assets section — a part hangs off a unit — so every
 * action checks `assets`, not `bookings`.
 */

/** Refreshes everything under the workspace, fleet and unit pages included. */
function revalidateComponents(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/**
 * Maps a Postgres error onto something worth showing in a form.
 *
 * Both of this section's unique indexes report `23505` and they mean different
 * things, so the message names the fitting rule — the one a person hits by hand.
 */
function writeErrorMessage(error: { message: string; code?: string }): string {
  if (error.code === "23505") {
    return "This workspace already has that address, or that unit already holds a part of this kind.";
  }
  if (error.code === "23503") {
    return "That kind or unit is no longer in this workspace.";
  }
  if (error.code === "23514") {
    return "A part cannot come off on or before the day it was fitted.";
  }
  return error.message;
}

/**
 * The page a component form should return to, given the hidden handle field.
 *
 * Parts are fitted and removed on the unit's Components tab, so that is where a
 * form comes back to — named through `assetTabSegment` rather than spelled out,
 * so a change to the tab's path cannot leave this behind.
 */
function assetPath(formData: FormData): string {
  const handle = readField(formData, "current_handle");
  return handle ? assetTabSegment(handle, "components") : "assets";
}

// -----------------------------------------------------------------------------
// The taxonomy
// -----------------------------------------------------------------------------
/** Adds a kind. */
export async function createComponentKind(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const parsed = parseComponentKindDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "assets/kinds", { error: parsed.error });
  }

  const { error } = await context.supabase.from("component_kinds").insert({
    company_id: context.company.id,
    ...parsed.draft,
  });

  if (error) {
    redirectWith(slug, "assets/kinds", { error: writeErrorMessage(error) });
  }

  revalidateComponents(slug);
  redirectWith(slug, "assets/kinds", { ok: `Added ${parsed.draft.name}.` });
}

/** Saves a kind's name, address or order. */
export async function updateComponentKind(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const kindId = readField(formData, "kind_id");
  if (!kindId) {
    redirectWith(slug, "assets/kinds", { error: "Choose a kind first." });
  }

  const parsed = parseComponentKindDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "assets/kinds", { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("component_kinds")
    .update(parsed.draft)
    .eq("id", kindId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, "assets/kinds", { error: writeErrorMessage(error) });
  }

  revalidateComponents(slug);
  redirectWith(slug, "assets/kinds", { ok: "Kind saved." });
}

/**
 * Removes a kind.
 *
 * Every component of that kind keeps its row and loses its `kind_id` — the
 * foreign key is `on delete set null` — so a taxonomy tidy-up never erases a
 * service history. The page says so rather than warning about it.
 */
export async function deleteComponentKind(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const kindId = readField(formData, "kind_id");
  if (!kindId) {
    redirectWith(slug, "assets/kinds", { error: "Choose a kind first." });
  }

  const { error } = await context.supabase
    .from("component_kinds")
    .delete()
    .eq("id", kindId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, "assets/kinds", { error: writeErrorMessage(error) });
  }

  revalidateComponents(slug);
  redirectWith(slug, "assets/kinds", { ok: "Kind deleted." });
}

// -----------------------------------------------------------------------------
// The components
// -----------------------------------------------------------------------------
/**
 * Records a component, fitted to a unit or sitting in the parts bin.
 *
 * The window is part of the payload here — unlike a booking line, whose window
 * belongs to its booking — because a fitting genuinely starts when the part is
 * put on, not when the shop was created.
 */
export async function createComponent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const parsed = parseComponentDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, assetPath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase.from("asset_components").insert({
    company_id: context.company.id,
    ...parsed.draft,
  });

  if (error) {
    redirectWith(slug, assetPath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateComponents(slug);
  redirectWith(slug, assetPath(formData), {
    ok: `Added ${parsed.draft.name}.`,
  });
}

/** Changes what a component is, which unit it is on, or when it came off. */
export async function updateComponent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const componentId = readField(formData, "component_id");
  if (!componentId) {
    redirectWith(slug, assetPath(formData), {
      error: "Choose a component first.",
    });
  }

  const parsed = parseComponentDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, assetPath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("asset_components")
    .update(parsed.draft)
    .eq("id", componentId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, assetPath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateComponents(slug);
  redirectWith(slug, assetPath(formData), { ok: "Component saved." });
}

/**
 * Takes a component off its unit today.
 *
 * A date rather than a delete: the part keeps its row, its service history and
 * its serial, and simply stops being fitted. An explicit `removed_on` may be
 * posted when the desk is catching up on yesterday's worksheet.
 */
export async function removeComponent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const componentId = readField(formData, "component_id");
  const back = assetPath(formData);
  if (!componentId) {
    redirectWith(slug, back, { error: "Choose a component first." });
  }

  const posted = readField(formData, "removed_on");
  const removedOn = posted || new Date().toISOString().slice(0, 10);

  const { error } = await context.supabase
    .from("asset_components")
    .update({ removed_on: removedOn })
    .eq("id", componentId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, {
      error:
        error.code === "23514"
          ? "A part cannot come off on or before the day it was fitted. Correct the fitted date first."
          : writeErrorMessage(error),
    });
  }

  revalidateComponents(slug);
  redirectWith(slug, back, { ok: "Component removed." });
}

/** Deletes a component outright. Manager work; removing it is the softer option. */
export async function deleteComponent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const componentId = readField(formData, "component_id");
  if (!componentId) {
    redirectWith(slug, assetPath(formData), {
      error: "Choose a component first.",
    });
  }

  const { error } = await context.supabase
    .from("asset_components")
    .delete()
    .eq("id", componentId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, assetPath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateComponents(slug);
  redirectWith(slug, assetPath(formData), { ok: "Component deleted." });
}
