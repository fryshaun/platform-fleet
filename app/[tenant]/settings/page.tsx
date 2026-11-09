import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCompany } from "@/lib/actions/settings";
import { getTenantContext } from "@/lib/auth";
import { canAdminister } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { MembersSection, type TeamMember } from "./members-section";
import { SectionsSection } from "./sections-section";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton />}>
        <SettingsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SettingsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings">["params"];
  searchParams: PageProps<"/[tenant]/settings">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role, user } = await getTenantContext(tenant);

  // Everything on this page is owner/admin work, so anyone below that gets a
  // 404 rather than a half-filled page.
  if (!canAdminister(role)) {
    notFound();
  }

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
    // `profiles_select_colleague`; the owner/admin check above is what makes
    // this list safe to show.
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
      <PageHeader
        title="Settings"
        description="Company details, team and billing."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${company.slug}/settings/billing`}>Billing</Link>
          </Button>
        }
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>
            The workspace address is permanent — it is the URL your team uses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateCompany} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="slug" value={company.slug} />

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={company.name}
                required
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug-readonly">Workspace address</Label>
              <Input
                id="slug-readonly"
                defaultValue={`/${company.slug}`}
                readOnly
                disabled
              />
            </div>

            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <SectionsSection slug={company.slug} enabled={company.enabled_sections} />

      <MembersSection
        slug={company.slug}
        members={team}
        currentUserId={user.id}
      />
    </div>
  );
}
