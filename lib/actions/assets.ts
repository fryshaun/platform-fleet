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
  ASSET_STATUS_LABELS,
  assetHandleProblem,
  assetNameProblem,
  deriveAssetHandle,
  isSettableAssetStatus,
  serialProblem,
} from "@/lib/assets";
import type { AssetStatus } from "@/lib/supabase/types";

/**
 * Writes for the assets section.
 *
 * Every action does the same four things, in this order: resolve the tenant,
 * check the section is switched on, check the tier, then write. The database
 * repeats all of it through RLS — this is what turns a refused write into a
 * sentence a person can read.
 *
 * The tier differs by action on purpose. Creating, editing and deleting units is
 * owner, admin and manager work; moving a unit between available and out of
 * action is front-desk work, so `setAssetStatus` asks for the front-desk tier
 * instead. That is the same split the policies in `20260101000300_assets.sql`
 * make.
 *
 * Results follow the pattern the rest of the app uses: a redirect back to the
 * page that owns the form with `?ok=` or `?error=`.
 */

/** An asset row, as the forms submit it. */
type AssetDraft = {
  name: string;
  handle: string;
  serial: string | null;
  /**
   * `null` when the form offered no status — a rented unit's does not, because
   * the booking owns it. Creating falls back to `available`; editing keeps the
   * stored value.
   */
  status: AssetStatus | null;
  product_id: string | null;
  notes: string | null;
};

/**
 * Refreshes everything under the workspace.
 *
 * The nearest layout is `app/[tenant]/layout.tsx`, so this covers the list, the
 * detail page — including a path that just changed because the handle did — and
 * the availability figures a product page shows, in one call.
 */
function revalidateAssets(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/**
 * Maps a Postgres error onto something worth showing in a form.
 *
 * Both unique indexes on the table report `23505`, so the message names both
 * candidates rather than guessing which one was hit.
 */
function writeErrorMessage(
  error: { message: string; code?: string },
  duplicate: string,
): string {
  if (error.code === "23505") return duplicate;
  if (error.code === "23503") {
    return "That product is no longer in this workspace.";
  }
  if (error.code === "23514") {
    return "Some of those values are out of range.";
  }
  return error.message;
}

/** The page an asset form should return to, given the hidden handle field. */
function assetPath(formData: FormData): string {
  const handle = readField(formData, "current_handle");
  return handle ? `assets/${handle}` : "assets";
}

/** Reads and validates the fields shared by create and update. */
function readAssetDraft(
  formData: FormData,
): { draft: AssetDraft } | { error: string } {
  const name = readField(formData, "name");
  const nameProblem = assetNameProblem(name);
  if (nameProblem) {
    return { error: nameProblem };
  }

  // The address is derived from the name unless the form supplies one, the same
  // rule products use. An edit whose field was cleared keeps the current address
  // rather than silently moving the URL.
  const handle =
    readField(formData, "handle") ||
    readField(formData, "current_handle") ||
    deriveAssetHandle(name);
  const handleProblem = assetHandleProblem(handle);
  if (handleProblem) {
    return { error: handleProblem };
  }

  // Empty means "leave the stored status alone". `rented` is not settable — the
  // database writes it from the bookings beneath the unit — so a posted value
  // that is not one of the three is still a mistake.
  const status = readField(formData, "status");
  if (status !== "" && !isSettableAssetStatus(status)) {
    return { error: "Choose a valid status." };
  }

  const serial = readField(formData, "serial");
  const serialFieldProblem = serialProblem(serial);
  if (serialFieldProblem) {
    return { error: serialFieldProblem };
  }

  return {
    draft: {
      name,
      handle,
      serial: serial || null,
      status: status === "" ? null : status,
      product_id: readField(formData, "product_id") || null,
      notes: readField(formData, "notes") || null,
    },
  };
}

export async function createAsset(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const parsed = readAssetDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, "assets", { error: parsed.error });
  }

  // A new unit has no booking behind it, so it needs a status and `available` is
  // the one a fleet starts in.
  const { status, ...rest } = parsed.draft;

  const { error } = await context.supabase.from("assets").insert({
    ...rest,
    status: status ?? "available",
    company_id: context.company.id,
  });

  if (error) {
    redirectWith(slug, "assets", {
      error: writeErrorMessage(
        error,
        "That address or serial number is already in use.",
      ),
    });
  }

  revalidateAssets(slug);
  redirectWith(slug, `assets/${parsed.draft.handle}`, {
    ok: `Added ${parsed.draft.name}.`,
  });
}

export async function updateAsset(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const assetId = readField(formData, "asset_id");
  const back = assetPath(formData);
  if (!assetId) {
    redirectWith(slug, back, { error: "Choose an asset first." });
  }

  const parsed = readAssetDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, back, { error: parsed.error });
  }

  const { status, ...rest } = parsed.draft;

  /**
   * The status is the one field that may belong to a booking rather than to this
   * form.
   *
   * `refresh_asset_rented()` (migration 25) writes `rented` from the lines
   * beneath a unit, so an edit that posted a status for a rented unit would
   * un-rent it behind the booking's back — and the form for a rented unit posts
   * none at all. Reading the stored row first is what makes that safe: a status
   * is written only when the form sent one *and* the unit is not out.
   */
  const { data: current } = await context.supabase
    .from("assets")
    .select("status")
    .eq("id", assetId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  const payload =
    status === null || current?.status === "rented"
      ? rest
      : { ...rest, status };

  const { error } = await context.supabase
    .from("assets")
    .update(payload)
    .eq("id", assetId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, {
      error: writeErrorMessage(
        error,
        "That address or serial number is already in use.",
      ),
    });
  }

  revalidateAssets(slug);
  redirectWith(slug, `assets/${parsed.draft.handle}`, { ok: "Asset saved." });
}

/**
 * Moves a unit between available, out of action and retired.
 *
 * Deliberately a field of its own rather than part of the edit form: this is the
 * one write the front desk owns, and it must not need the rest of the record —
 * or the manager tier — to happen. Only `status` is sent, so nothing else can be
 * changed through this action.
 */
export async function setAssetStatus(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const back = assetPath(formData);
  const assetId = readField(formData, "asset_id");
  if (!assetId) {
    redirectWith(slug, back, { error: "Choose an asset first." });
  }

  const status = readField(formData, "status");
  if (!isSettableAssetStatus(status)) {
    redirectWith(slug, back, {
      error:
        status === "rented"
          ? "A unit is marked out on hire by its booking, not by hand."
          : "Choose a valid status.",
    });
  }

  // A rented unit is out with a renter. Its status belongs to the booking until
  // that booking comes back, so the desk cancels or completes the hire first.
  const { data: current } = await context.supabase
    .from("assets")
    .select("status")
    .eq("id", assetId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (current?.status === "rented") {
    redirectWith(slug, back, {
      error:
        "That unit is out on hire. Complete or cancel the booking before changing its status.",
    });
  }

  const { error } = await context.supabase
    .from("assets")
    .update({ status })
    .eq("id", assetId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateAssets(slug);
  redirectWith(slug, back, {
    ok: `Marked ${ASSET_STATUS_LABELS[status].toLowerCase()}.`,
  });
}

/** Deletes a unit. Its history goes with it; retiring is the softer option. */
export async function deleteAsset(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const assetId = readField(formData, "asset_id");
  if (!assetId) {
    redirectWith(slug, "assets", { error: "Choose an asset first." });
  }

  const back = assetPath(formData);

  // A unit that is out is still earning; deleting its row while a booking holds
  // it would drop the hire's history. Retiring is the softer option anyway.
  const { data: current } = await context.supabase
    .from("assets")
    .select("status")
    .eq("id", assetId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (current?.status === "rented") {
    redirectWith(slug, back, {
      error:
        "That unit is out on hire. Complete or cancel the booking before deleting it.",
    });
  }

  const { error } = await context.supabase
    .from("assets")
    .delete()
    .eq("id", assetId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateAssets(slug);
  redirectWith(slug, "assets", { ok: "Asset deleted." });
}

