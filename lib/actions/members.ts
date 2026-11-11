"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  redirectWith,
  requireAdministrator,
} from "@/lib/actions/support";
import { isAssignableRole, ROLE_LABELS } from "@/lib/roles";
import { settingsPath, settingsSegment } from "@/lib/settings";
import { getOrigin } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds somebody to the workspace.
 *
 * Both paths create a *pending* membership, which grants nothing until the
 * person accepts it: the membership predicates ignore rows with a null
 * `accepted_at`, so `/workspaces` and every tenant page are closed to them.
 *
 * - An existing account gets a membership row and an invitation to accept in
 *   the app.
 * - Anyone else is created through `inviteUserByEmail`, which sends Supabase's
 *   invite email and creates the `auth.users` row (and, through the trigger,
 *   their profile). Clicking that link is itself consent, so
 *   `/auth/callback` accepts the membership for `type=invite`.
 *
 * Both paths answer with the same message on purpose: the response must not
 * reveal whether an address already has an account.
 */
export async function inviteMember(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const email = readField(formData, "email").toLowerCase();
  const role = readField(formData, "role");

  if (!EMAIL_PATTERN.test(email)) {
    redirectWith(slug, settingsSegment("team"), { error: "Enter a valid email address." });
  }
  if (!isAssignableRole(role)) {
    redirectWith(slug, settingsSegment("team"), { error: "Choose a role for this person." });
  }

  const admin = createAdminClient();

  // Profiles mirror auth.users, so an existing row means the address already
  // has an account and does not need another invitation email.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileError) {
    redirectWith(slug, settingsSegment("team"), { error: profileError.message });
  }

  if (profile) {
    const { data: existing } = await context.supabase
      .from("company_members")
      .select("id")
      .eq("company_id", context.company.id)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (existing) {
      redirectWith(slug, settingsSegment("team"), {
        error: `${email} is already in this workspace.`,
      });
    }

    const { error } = await context.supabase.from("company_members").insert({
      company_id: context.company.id,
      user_id: profile.id,
      role,
      invited_at: new Date().toISOString(),
      // Pending until they accept: RLS ignores rows without `accepted_at`.
      accepted_at: null,
    });

    if (error) {
      redirectWith(slug, settingsSegment("team"), { error: membershipErrorMessage(error) });
    }

    revalidatePath(settingsPath(slug, "team"));
    redirectWith(slug, settingsSegment("team"), { ok: invitationSentMessage(email) });
  }

  const origin = await getOrigin();
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(
    `/${slug}/dashboard`,
  )}`;

  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      // Available to the template as `{{ index .Data "company_name" }}`, so the
      // invitation can say which workspace is asking before the person opens it.
      data: { company_name: context.company.name },
    });

  if (inviteError || !invited.user) {
    redirectWith(slug, settingsSegment("team"), {
      error: inviteErrorMessage(
        inviteError?.message ?? "Could not send the invitation.",
      ),
    });
  }

  const { error: membershipError } = await context.supabase
    .from("company_members")
    .insert({
      company_id: context.company.id,
      user_id: invited.user.id,
      role,
      invited_at: new Date().toISOString(),
      accepted_at: null,
    });

  if (membershipError) {
    // The auth user was created solely for this invitation, so leaving them
    // behind would strand an account that belongs to no workspace. If this was
    // a duplicate membership, the account predates the call and is kept.
    if (membershipError.code !== "23505") {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        invited.user.id,
      );
      if (cleanupError) {
        console.error(
          `[members] Could not roll back invited user ${invited.user.id}: ${cleanupError.message}`,
        );
      }
    }

    redirectWith(slug, settingsSegment("team"), {
      error: membershipErrorMessage(membershipError),
    });
  }

  revalidatePath(settingsPath(slug, "team"));
  redirectWith(slug, settingsSegment("team"), { ok: invitationSentMessage(email) });
}

/** Changes an assignable membership between manager, staff and viewer. */
export async function updateMemberRole(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const membershipId = readField(formData, "membership_id");
  const role = readField(formData, "role");

  if (!membershipId) {
    redirectWith(slug, settingsSegment("team"), { error: "Missing team member." });
  }
  if (!isAssignableRole(role)) {
    redirectWith(slug, settingsSegment("team"), { error: "Choose a valid role." });
  }

  const { data: member } = await context.supabase
    .from("company_members")
    .select("id, role")
    .eq("id", membershipId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!member) {
    redirectWith(slug, settingsSegment("team"), { error: "That team member was not found." });
  }
  if (!isAssignableRole(member.role)) {
    redirectWith(slug, settingsSegment("team"), {
      error: "Owner and admin roles cannot be changed here.",
    });
  }

  const { error } = await context.supabase
    .from("company_members")
    .update({ role })
    .eq("id", membershipId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, settingsSegment("team"), { error: error.message });
  }

  revalidatePath(settingsPath(slug, "team"));
  redirectWith(slug, settingsSegment("team"), {
    ok: `Role updated to ${ROLE_LABELS[role]}.`,
  });
}

/** Removes a manager, staff member or viewer. Owners and admins are protected. */
export async function removeMember(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const membershipId = readField(formData, "membership_id");
  if (!membershipId) {
    redirectWith(slug, settingsSegment("team"), { error: "Missing team member." });
  }

  const { data: member } = await context.supabase
    .from("company_members")
    .select("id, role")
    .eq("id", membershipId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!member) {
    redirectWith(slug, settingsSegment("team"), { error: "That team member was not found." });
  }
  if (!isAssignableRole(member.role)) {
    redirectWith(slug, settingsSegment("team"), {
      error: "Owner and admin roles cannot be removed here.",
    });
  }

  const { error } = await context.supabase
    .from("company_members")
    .delete()
    .eq("id", membershipId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, settingsSegment("team"), { error: error.message });
  }

  revalidatePath(settingsPath(slug, "team"));
  redirectWith(slug, settingsSegment("team"), { ok: "Team member removed." });
}

function membershipErrorMessage(error: { message: string; code?: string }) {
  if (error.code === "23505") {
    return "That person is already in this workspace.";
  }
  return error.message;
}

/**
 * The single answer both invitation paths give.
 *
 * Saying "added them" for an existing account and "invitation sent" for a new
 * one would let an owner or admin use this form to test whether an address has
 * an account. The two branches differ only on the server.
 */
function invitationSentMessage(email: string) {
  return `Invitation sent to ${email}.`;
}

function inviteErrorMessage(message: string) {
  if (/rate limit|security purposes/i.test(message)) {
    return "Wait a minute before sending another invitation.";
  }
  // Supabase answers "already registered" when an account appeared between the
  // profile lookup above and this call. Repeating that message would tell the
  // caller the address has an account, so answer like any other failure.
  if (/already registered|already been registered/i.test(message)) {
    return "Could not send the invitation. Try again.";
  }
  return message;
}

