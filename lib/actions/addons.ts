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
import {
  ADDON_STATUS_LABELS,
  addonQuantityProblem,
  isAddonStatus,
  parseAddonDraft,
} from "@/lib/addons";

/**
 * Writes for the extras catalogue and for the extras on a booking line.
 *
 * Two halves, two tiers, on purpose:
 *
 *   the catalogue · manager work, like products. What the shop offers and what
 *                   it charges is not a front-desk decision.
 *   the line      · front-desk work. A staff member adding a helmet at
 *                   collection must not need to fetch a manager.
 *
 * Every action does the same five things, in this order: resolve the tenant,
 * check the section is switched on, check the tier, check the workspace may
 * still write, then write. RLS repeats all of it — this is what turns a refusal
 * into a sentence.
 *
 * `23514` is deliberately *not* translated here: the triggers on
 * `booking_line_addons` raise `check_violation` with a sentence written for a
 * person ("That extra is not offered with the product on this line"), and a
 * generic replacement would throw that away.
 */

/** Refreshes everything under the workspace, board and detail page included. */
function revalidateAddons(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/** Maps a Postgres error onto something worth showing in a form. */
function writeErrorMessage(error: { message: string; code?: string }): string {
  if (error.code === "23505") {
    return "That address is already in use in this workspace.";
  }
  if (error.code === "23503") {
    return "That extra is used by a booking, so it cannot be deleted. Archive it instead.";
  }
  return error.message;
}

/** The page a booking form should return to, given the hidden reference field. */
function bookingPath(formData: FormData): string {
  const reference = readField(formData, "reference");
  return reference ? `bookings/${reference}` : "bookings";
}

/** The product ids a scope form ticked, ignoring anything unnamed. */
function readProductIds(formData: FormData): string[] {
  return formData
    .getAll("product_ids")
    .filter(
      (value): value is string => typeof value === "string" && value !== "",
    );
}

// -----------------------------------------------------------------------------
// The catalogue
// -----------------------------------------------------------------------------
/** Adds an extra to the catalogue. */
export async function createAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const parsed = parseAddonDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "bookings/add-ons", { error: parsed.error });
  }

  const { error } = await context.supabase.from("addons").insert({
    company_id: context.company.id,
    ...parsed.draft,
  });

  if (error) {
    redirectWith(slug, "bookings/add-ons", {
      error: writeErrorMessage(error),
    });
  }

  revalidateAddons(slug);
  redirectWith(slug, "bookings/add-ons", {
    ok: `Added ${parsed.draft.name}.`,
  });
}

/**
 * Saves the catalogue row, and its scope when the form carries one.
 *
 * The scope is a second write through `set_addon_products`, which replaces the
 * whole list in one transaction. Two separate client writes could fail between
 * each other and leave an extra scoped to nothing — which the schema reads as
 * *every* product, the one dangerous failure mode this design has.
 */
export async function updateAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const addonId = readField(formData, "addon_id");
  if (!addonId) {
    redirectWith(slug, "bookings/add-ons", { error: "Choose an extra first." });
  }

  const parsed = parseAddonDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "bookings/add-ons", { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("addons")
    .update(parsed.draft)
    .eq("id", addonId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, "bookings/add-ons", {
      error: writeErrorMessage(error),
    });
  }

  // Only the full form sends this marker. A quick edit that does not show the
  // product picker must not silently clear the scope.
  if (readField(formData, "scope") === "1") {
    const { error: scopeError } = await context.supabase.rpc(
      "set_addon_products",
      {
        target_addon_id: addonId,
        product_ids: readProductIds(formData),
      },
    );

    if (scopeError) {
      redirectWith(slug, "bookings/add-ons", { error: scopeError.message });
    }
  }

  revalidateAddons(slug);
  redirectWith(slug, "bookings/add-ons", { ok: "Extra saved." });
}

/**
 * Takes an extra off the picker, or puts it back.
 *
 * Archiving is the reversible half of deleting, and it is what the page offers
 * for an extra a booking already took: the foreign key refuses a delete, and the
 * message says so.
 */
export async function setAddonStatus(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const addonId = readField(formData, "addon_id");
  if (!addonId) {
    redirectWith(slug, "bookings/add-ons", { error: "Choose an extra first." });
  }

  const status = readField(formData, "status");
  if (!isAddonStatus(status)) {
    redirectWith(slug, "bookings/add-ons", { error: "Choose a valid status." });
  }

  const { error } = await context.supabase
    .from("addons")
    .update({ status })
    .eq("id", addonId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, "bookings/add-ons", { error: writeErrorMessage(error) });
  }

  revalidateAddons(slug);
  redirectWith(slug, "bookings/add-ons", {
    ok: `Marked ${ADDON_STATUS_LABELS[status].toLowerCase()}.`,
  });
}

/** Removes a catalogue row nobody has taken. Archiving is the softer option. */
export async function deleteAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const addonId = readField(formData, "addon_id");
  if (!addonId) {
    redirectWith(slug, "bookings/add-ons", { error: "Choose an extra first." });
  }

  const { error } = await context.supabase
    .from("addons")
    .delete()
    .eq("id", addonId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, "bookings/add-ons", { error: writeErrorMessage(error) });
  }

  revalidateAddons(slug);
  redirectWith(slug, "bookings/add-ons", { ok: "Extra deleted." });
}

// -----------------------------------------------------------------------------
// The extras on a line
// -----------------------------------------------------------------------------
/**
 * Puts an extra on a line.
 *
 * The price and the kind are not sent: `booking_line_addons_snapshot` copies
 * both from the catalogue, and a form that could set them could invent a
 * discount. The quantity is checked here as well as in the trigger, so the desk
 * reads the ceiling in the message rather than a bare `23514`.
 */
export async function addLineAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineItemId = readField(formData, "line_item_id");
  const back = bookingPath(formData);
  if (!lineItemId) {
    redirectWith(slug, back, { error: "Choose a line first." });
  }

  const addonId = readField(formData, "addon_id");
  if (!addonId) {
    redirectWith(slug, back, { error: "Choose an extra first." });
  }

  const { data: addon } = await context.supabase
    .from("addons")
    .select("id, name, max_quantity, status")
    .eq("id", addonId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!addon) {
    redirectWith(slug, back, { error: "That extra is no longer here." });
  }

  if (addon.status !== "active") {
    redirectWith(slug, back, {
      error: "That extra is archived and cannot be added.",
    });
  }

  const quantity = Number.parseInt(readField(formData, "quantity") || "1", 10);
  const quantityProblem = addonQuantityProblem(quantity, addon.max_quantity);
  if (quantityProblem) {
    redirectWith(slug, back, { error: quantityProblem });
  }

  const { error } = await context.supabase.from("booking_line_addons").insert({
    company_id: context.company.id,
    line_item_id: lineItemId,
    addon_id: addonId,
    quantity,
  });

  if (error) {
    redirectWith(slug, back, {
      error:
        error.code === "23505"
          ? "That extra is already on this line — change its quantity instead."
          : error.message,
    });
  }

  revalidateAddons(slug);
  redirectWith(slug, back, { ok: `Added ${addon.name}.` });
}

/** Changes how many of an extra a line takes. */
export async function updateLineAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineAddonId = readField(formData, "line_addon_id");
  const back = bookingPath(formData);
  if (!lineAddonId) {
    redirectWith(slug, back, { error: "Choose an extra first." });
  }

  const quantity = Number.parseInt(readField(formData, "quantity") || "0", 10);
  if (!Number.isInteger(quantity) || quantity < 1) {
    redirectWith(slug, back, {
      error: "Choose at least one, or remove the extra.",
    });
  }

  const { error } = await context.supabase
    .from("booking_line_addons")
    .update({ quantity })
    .eq("id", lineAddonId)
    .eq("company_id", context.company.id);

  if (error) {
    // `23514` here is the ceiling message the trigger wrote for a person.
    redirectWith(slug, back, {
      error: error.code === "23514" ? error.message : writeErrorMessage(error),
    });
  }

  revalidateAddons(slug);
  redirectWith(slug, back, { ok: "Extra updated." });
}

/** Takes an extra off a line. The line itself stays as it was. */
export async function removeLineAddon(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "bookings");
  requireWritableWorkspace(context, slug, "bookings");

  const lineAddonId = readField(formData, "line_addon_id");
  const back = bookingPath(formData);
  if (!lineAddonId) {
    redirectWith(slug, back, { error: "Choose an extra first." });
  }

  const { error } = await context.supabase
    .from("booking_line_addons")
    .delete()
    .eq("id", lineAddonId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: writeErrorMessage(error) });
  }

  revalidateAddons(slug);
  redirectWith(slug, back, { ok: "Extra removed." });
}
