import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageSkeleton } from "@/components/tenant/page-header";
import { canAdminister } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { NEW_USAGE_FORM_ID, usageForAsset, usageSummary } from "@/lib/usage";

import { requireAssetPage } from "../../asset-access";
import { AssetHeader } from "../../asset-header";
import { UsageFields } from "./usage-fields";
import { UsageSection } from "./usage-section";

export const metadata: Metadata = {
  title: "Asset usage",
};

/**
 * What this unit has actually done, one reading at a time.
 *
 * Readings are incremental, so the list *is* the history and the totals above it
 * are a sum — nothing is stored, and a corrected reading moves the service
 * arithmetic on the next tab the moment it is saved.
 */
export default function AssetUsagePage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets/[handle]/usage">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <UsageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function UsageContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets/[handle]/usage">["params"];
  searchParams: PageProps<"/[tenant]/assets/[handle]/usage">["searchParams"];
}) {
  const [{ tenant, handle }, query] = await Promise.all([params, searchParams]);
  const { company, role, asset, supabase, writable, canFit, canEdit } =
    await requireAssetPage(tenant, handle);

  const { data: logRows } = await supabase
    .from("asset_usage_logs")
    .select("*")
    .eq("company_id", company.id)
    .eq("asset_id", asset.id)
    .order("logged_on", { ascending: false });

  const logs = usageForAsset(logRows ?? [], asset.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <AssetHeader slug={company.slug} asset={asset} current="usage" />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <section aria-labelledby="usage-heading" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="usage-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Usage
            </h2>
            <p className="text-muted-foreground text-sm">{usageSummary(logs)}</p>
          </div>

          {canFit ? (
            <FormSheet
              triggerLabel="Log a reading"
              title="Log a reading"
              description="What the unit did since the last reading — hours, kilometres, or both. Back-dating a worksheet is normal: set the day it happened."
              formId={NEW_USAGE_FORM_ID}
              submitLabel="Log reading"
            >
              <FormMessage error={readParam(query.error)} />
              <UsageFields
                slug={company.slug}
                asset={asset}
                layout="panel"
                formId={NEW_USAGE_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          ) : null}
        </div>

        {logs.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {canFit
                ? "No readings yet. Use “Log a reading” at the top of the card — a part's service interval needs these to know how far it has gone."
                : "No readings are recorded for this unit."}
            </p>
          </div>
        ) : (
          <UsageSection
            slug={company.slug}
            asset={asset}
            logs={logs}
            canEdit={canFit}
            canDelete={canEdit}
          />
        )}
      </section>
    </div>
  );
}
