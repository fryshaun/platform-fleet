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
import { parseUsageDraft } from "@/lib/usage";

/**
 * Writes for a unit's usage log.
 *
 * The split is migration 21's: logging a reading is the desk's work — it is what
 * whoever hands the unit back writes on the worksheet — while deleting one is a
 * manager's, because a reading is what a service interval counts from.
 *
 * Every action returns to the unit's Usage tab, named through `assetTabSegment`
 * so a change to the tab's path cannot leave these behind.
 */

/** Refreshes everything under the workspace: the fleet, the unit, its service. */
function revalidateUsage(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/** The Usage tab of the unit named by the hidden handle field. */
function usagePath(formData: FormData): string {
  const handle = readField(formData, "current_handle");
  return handle ? assetTabSegment(handle, "usage") : "assets";
}

/** Maps a Postgres error onto something worth showing in a form. */
function writeErrorMessage(error: { message: string; code?: string }): string {
  if (error.code === "23514") {
    return "A reading needs hours, kilometres, or both.";
  }
  if (error.code === "23503") {
    return "That unit is no longer in this workspace.";
  }
  return error.message;
}

/** Logs one reading against a unit. */
export async function createUsageLog(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const assetId = readField(formData, "asset_id");
  if (!assetId) {
    redirectWith(slug, usagePath(formData), { error: "Choose a unit first." });
  }

  const parsed = parseUsageDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, usagePath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase.from("asset_usage_logs").insert({
    company_id: context.company.id,
    asset_id: assetId,
    ...parsed.draft,
  });

  if (error) {
    redirectWith(slug, usagePath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateUsage(slug);
  redirectWith(slug, usagePath(formData), { ok: "Reading logged." });
}

/**
 * Corrects a reading.
 *
 * The unit is left alone: moving a reading to another unit would silently change
 * two units' service arithmetic, so that is a delete and a re-log rather than an
 * edit.
 */
export async function updateUsageLog(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const logId = readField(formData, "usage_log_id");
  if (!logId) {
    redirectWith(slug, usagePath(formData), {
      error: "Choose a reading first.",
    });
  }

  const parsed = parseUsageDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, usagePath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("asset_usage_logs")
    .update(parsed.draft)
    .eq("id", logId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, usagePath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateUsage(slug);
  redirectWith(slug, usagePath(formData), { ok: "Reading saved." });
}

/** Deletes a reading. Manager work: it moves what every interval has seen. */
export async function deleteUsageLog(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const logId = readField(formData, "usage_log_id");
  if (!logId) {
    redirectWith(slug, usagePath(formData), {
      error: "Choose a reading first.",
    });
  }

  const { error } = await context.supabase
    .from("asset_usage_logs")
    .delete()
    .eq("id", logId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, usagePath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateUsage(slug);
  redirectWith(slug, usagePath(formData), { ok: "Reading deleted." });
}
