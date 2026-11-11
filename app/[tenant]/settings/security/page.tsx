import type { Metadata } from "next";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { PageSkeleton } from "@/components/tenant/page-header";
import { readParam } from "@/lib/search-params";

import { requireSettingsAccess } from "../settings-access";
import { SettingsHeader } from "../settings-header";
import { SecuritySection } from "./security-section";

export const metadata: Metadata = {
  title: "Security",
};

export default function SecurityPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/security">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <SecuritySettings params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Security tab: what this workspace demands of every sign-in. */
async function SecuritySettings({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings/security">["params"];
  searchParams: PageProps<"/[tenant]/settings/security">["searchParams"];
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, user } = await requireSettingsAccess(tenant);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <SettingsHeader
        slug={company.slug}
        current="security"
        description="How the people in this workspace prove who they are."
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <SecuritySection
        slug={company.slug}
        requireMfa={company.require_mfa}
        enrolled={user.mfa.enrolled}
      />
    </div>
  );
}
