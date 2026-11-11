import type { Metadata } from "next";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { PageSkeleton } from "@/components/tenant/page-header";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { requireSettingsAccess } from "../settings-access";
import { SettingsHeader } from "../settings-header";
import { MembersSection, type TeamMember } from "./members-section";

export const metadata: Metadata = {
  title: "Team",
};

export default function TeamPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/team">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <TeamSettings params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Team tab: who can open this workspace, and what each of them may do. */
async function TeamSettings({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings/team">["params"];
  searchParams: PageProps<"/[tenant]/settings/team">["searchParams"];
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, user } = await requireSettingsAccess(tenant);

  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("company_members")
    .select("id, user_id, role, invited_at, accepted_at, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });

  const rows = memberships ?? [];
  const profilesById = new Map<
    string,
    { email: string; full_name: string | null }
  >();

  if (rows.length > 0) {
    // Colleagues can read each other's profiles through
    // `profiles_select_colleague`; the owner/admin check inside
    // `requireSettingsAccess` is what makes this list safe to show.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in(
        "id",
        rows.map((row) => row.user_id),
      );

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        email: profile.email,
        full_name: profile.full_name,
      });
    }
  }

  const team: TeamMember[] = rows.map((row) => {
    const profile = profilesById.get(row.user_id);

    return {
      id: row.id,
      userId: row.user_id,
      email: profile?.email ?? "Unknown email",
      fullName: profile?.full_name ?? null,
      role: row.role,
      invitedAt: row.invited_at,
      acceptedAt: row.accepted_at,
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <SettingsHeader
        slug={company.slug}
        current="team"
        description="Who can open this workspace, and what each of them may do."
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <MembersSection
        slug={company.slug}
        members={team}
        currentUserId={user.id}
      />
    </div>
  );
}
