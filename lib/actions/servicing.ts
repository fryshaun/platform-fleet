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
import { parseServiceEventDraft } from "@/lib/servicing";

/**
 * Writes for the service history.
 *
 * Recording a service is the front desk's work — it is the line on the worksheet
 * — and deleting one is a manager's, because a service resets the interval the
 * whole shop reads. Neither touches the part: `serviced_on` is the only thing the
 * arithmetic counts from, so a service can never change what a part is or where
 * it is fitted.
 */

/** Refreshes everything under the workspace: the fleet, the unit, its parts. */
function revalidateServicing(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/** The Service tab of the unit named by the hidden handle field. */
function servicePath(formData: FormData): string {
  const handle = readField(formData, "current_handle");
  return handle ? assetTabSegment(handle, "service") : "assets";
}

/** Maps a Postgres error onto something worth showing in a form. */
function writeErrorMessage(error: { message: string; code?: string }): string {
  if (error.code === "23503") {
    return "That part is no longer in this workspace.";
  }
  return error.message;
}

/** Records one service against a part. */
export async function createServiceEvent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireFrontDesk(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const parsed = parseServiceEventDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, servicePath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("component_service_events")
    .insert({
      company_id: context.company.id,
      ...parsed.draft,
    });

  if (error) {
    redirectWith(slug, servicePath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateServicing(slug);
  redirectWith(slug, servicePath(formData), {
    ok: "Service recorded. The interval counts from this day.",
  });
}

/** Deletes a service event. Manager work: it moves the interval back. */
export async function deleteServiceEvent(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "assets");
  requireWritableWorkspace(context, slug, "assets");

  const eventId = readField(formData, "service_event_id");
  if (!eventId) {
    redirectWith(slug, servicePath(formData), {
      error: "Choose a service first.",
    });
  }

  const { error } = await context.supabase
    .from("component_service_events")
    .delete()
    .eq("id", eventId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, servicePath(formData), {
      error: writeErrorMessage(error),
    });
  }

  revalidateServicing(slug);
  redirectWith(slug, servicePath(formData), { ok: "Service deleted." });
}
