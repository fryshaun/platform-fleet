import type { Metadata } from "next";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { PageSkeleton } from "@/components/tenant/page-header";
import { readParam } from "@/lib/search-params";

import { requireSettingsAccess } from "../settings-access";
import { SettingsHeader } from "../settings-header";
import { ExtensionsSection } from "./extensions-section";

export const metadata: Metadata = {
  title: "Extensions",
};

export default function ExtensionsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/extensions">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <ExtensionsSettings params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Extensions tab: which optional parts of the app this workspace has on. */
async function ExtensionsSettings({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings/extensions">["params"];
  searchParams: PageProps<"/[tenant]/settings/extensions">["searchParams"];
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company } = await requireSettingsAccess(tenant);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <SettingsHeader
        slug={company.slug}
        current="extensions"
        description="Optional parts of the app. Switching one off hides it; nothing is deleted."
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <ExtensionsSection slug={company.slug} enabled={company.enabled_sections} />
    </div>
  );
}
