import type { Metadata } from "next";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { PageSkeleton } from "@/components/tenant/page-header";
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
import { readParam } from "@/lib/search-params";

import { requireSettingsAccess } from "./settings-access";
import { SettingsHeader } from "./settings-header";

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
        <CompanySettings params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Company tab: the one field that changes after onboarding. */
async function CompanySettings({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings">["params"];
  searchParams: PageProps<"/[tenant]/settings">["searchParams"];
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company } = await requireSettingsAccess(tenant);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <SettingsHeader
        slug={company.slug}
        current="company"
        description="What this workspace is called, and the address your team uses."
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
    </div>
  );
}
