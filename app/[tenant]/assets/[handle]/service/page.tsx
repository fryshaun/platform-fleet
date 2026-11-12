import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageSkeleton } from "@/components/tenant/page-header";
import { componentsForAsset, isFitted } from "@/lib/components";
import { canAdminister } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import {
  type ComponentServiceStatus,
  NEW_SERVICE_FORM_ID,
  type ServiceEvent,
  serviceSummary,
} from "@/lib/servicing";

import { requireAssetPage } from "../../asset-access";
import { AssetHeader } from "../../asset-header";
import { ServiceFields } from "./service-fields";
import { ServiceSection } from "./service-section";

export const metadata: Metadata = {
  title: "Asset service",
};

/**
 * What each part on this unit has done, and whether it is due.
 *
 * Nothing here is stored: `component_service_status` derives the status from the
 * kind's interval, the part's fitted window and this unit's usage readings, so
 * the tab cannot show a state that yesterday's reading has already changed. The
 * page only reads it — and writes a service event, which is what resets the
 * count.
 */
export default function AssetServicePage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets/[handle]/service">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <ServiceContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ServiceContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets/[handle]/service">["params"];
  searchParams: PageProps<"/[tenant]/assets/[handle]/service">["searchParams"];
}) {
  const [{ tenant, handle }, query] = await Promise.all([params, searchParams]);
  const { company, role, asset, supabase, writable, canFit, canEdit } =
    await requireAssetPage(tenant, handle);

  const [{ data: componentRows }, { data: kindRows }, { data: statusRows }] =
    await Promise.all([
      supabase
        .from("asset_components")
        .select("*")
        .eq("company_id", company.id)
        .eq("asset_id", asset.id),
      supabase
        .from("component_kinds")
        .select("*")
        .eq("company_id", company.id)
        .order("position", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("component_service_status")
        .select("*")
        .eq("company_id", company.id)
        .eq("asset_id", asset.id),
    ]);

  const components = componentsForAsset(componentRows ?? [], asset.id);
  const kinds = kindRows ?? [];
  const componentIds = components.map((component) => component.id);

  // One query for the whole unit rather than one per card. `in` with an empty
  // list would be a syntax error, so a unit with no parts asks for nothing.
  const events: ServiceEvent[] = componentIds.length
    ? ((
        await supabase
          .from("component_service_events")
          .select("*")
          .eq("company_id", company.id)
          .in("component_id", componentIds)
      ).data ?? [])
    : [];

  const statuses = new Map<string, ComponentServiceStatus>(
    (statusRows ?? []).map((row) => [row.component_id, row]),
  );

  // Only the parts still fitted are counted in the summary. A part in the parts
  // bin keeps its card and its history, but it cannot be overdue for a service it
  // will never be given.
  const fitted = components.filter(isFitted);
  const counting = fitted
    .map((component) => statuses.get(component.id))
    .filter((row): row is ComponentServiceStatus => row !== undefined);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <AssetHeader slug={company.slug} asset={asset} current="service" />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <section aria-labelledby="service-heading" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="service-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Service
            </h2>
            <p className="text-muted-foreground text-sm">
              {serviceSummary(counting)}
            </p>
          </div>

          {canFit && fitted.length > 0 ? (
            <FormSheet
              triggerLabel="Record a service"
              title="Record a service"
              description="Recording a service resets the interval to zero for that part, from the day it happened."
              formId={NEW_SERVICE_FORM_ID}
              submitLabel="Record service"
            >
              <FormMessage error={readParam(query.error)} />
              <ServiceFields
                slug={company.slug}
                asset={asset}
                components={fitted}
                formId={NEW_SERVICE_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          ) : null}
        </div>

        {components.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              No parts on this unit yet, so there is nothing to service. Fit a
              part on the Components tab and its kind&apos;s interval starts
              counting.
            </p>
          </div>
        ) : (
          <ServiceSection
            slug={company.slug}
            asset={asset}
            components={components}
            statuses={statuses}
            events={events}
            kinds={kinds}
            canDelete={canEdit}
          />
        )}
      </section>
    </div>
  );
}

