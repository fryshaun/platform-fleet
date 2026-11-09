"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { readField } from "@/lib/actions/support";
import { createClient } from "@/lib/supabase/server";

/**
 * Accepts or declines an invitation to a workspace.
 *
 * This is deliberately not a tenant action: the caller has no access to the
 * company yet, so there is no slug to resolve and no membership to check. The
 * database holds the authorization — `respond_to_company_invitation()` only
 * matches rows where `user_id = auth.uid() and accepted_at is null` — and the
 * response is the same whether the row was theirs, somebody else's or already
 * gone, so the form cannot be used to probe for memberships.
 */
export async function respondToInvitation(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/workspaces")}`);
  }

  const membershipId = readField(formData, "membership_id");
  const decision = readField(formData, "decision");

  if (!membershipId || (decision !== "accept" && decision !== "decline")) {
    redirect(
      `/workspaces?error=${encodeURIComponent(
        "That invitation is no longer available.",
      )}`,
    );
  }

  const { error } = await supabase.rpc("respond_to_company_invitation", {
    target_membership_id: membershipId,
    accept: decision === "accept",
  });

  if (error) {
    redirect(`/workspaces?error=${encodeURIComponent(error.message)}`);
  }

  // The pending-invitations list and the workspace list both live here.
  revalidatePath("/workspaces");

  redirect(
    `/workspaces?ok=${encodeURIComponent(
      decision === "accept" ? "Invitation accepted." : "Invitation declined.",
    )}`,
  );
}
