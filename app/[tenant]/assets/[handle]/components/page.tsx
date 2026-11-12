import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageSkeleton } from "@/components/tenant/page-header";
import {
  componentsForAsset,
  isFitted,
  NEW_COMPONENT_FORM_ID,
} from "@/lib/components";
import { canAdminister } from "@/lib/roles";
import { readParam } from "@/lib/search-params";

import { requireAssetPage } from "../../asset-access";
import { AssetHeader } from "../../asset-header";
import { ComponentFields } from "./component-fields";
import { ComponentsSection } from "./components-section";

export const metadata: Metadata = {
  title: "Asset components",
};

/**
 * The parts fitted to one unit, and the history of the ones that came off.
 *
 * Removing a part is a date rather than a delete — the row keeps its serial and
 * its service history — so this tab is a list that only grows, which is why it
 * has a tab of its own instead of sitting on the overview.
 */
export default function AssetComponentsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets/[handle]/components">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <ComponentsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ComponentsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets/[handle]/components">["params"];
  searchParams: PageProps<"/[tenant]/assets/[handle]/components">["searchParams"];
}) {
  const [{ tenant, handle }, query] = await Promise.all([params, searchParams]);
  const { company, role, asset, supabase, writable, canFit, canEdit } =
    await requireAssetPage(tenant, handle);

  const [{ data: componentRows }, { data: kindRows }] = await Promise.all([
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
  ]);

  // Fitted ones first, newest fitting first: the parts on the bike now are what
  // the page is for, the history is there to be read.
  const components = componentsForAsset(componentRows ?? [], asset.id);
  const kinds = kindRows ?? [];
  const fitted = components.filter(isFitted).length;
  const removed = components.length - fitted;

  const summary =
    components.length === 0
      ? "No parts recorded."
      : [
          `${fitted} fitted`,
          removed > 0 ? `${removed} removed` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <AssetHeader slug={company.slug} asset={asset} current="components" />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <section aria-labelledby="parts-heading" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="parts-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Parts
            </h2>
            <p className="text-muted-foreground text-sm">{summary}</p>
          </div>

          {canFit ? (
            <FormSheet
              triggerLabel="Fit a part"
              title="Fit a part"
              description="A serial number is worth recording here: it is what tells two of the same fork apart when one of them is serviced."
              formId={NEW_COMPONENT_FORM_ID}
              submitLabel="Fit part"
            >
              <FormMessage error={readParam(query.error)} />
              <ComponentFields
                slug={company.slug}
                asset={asset}
                kinds={kinds}
                layout="panel"
                formId={NEW_COMPONENT_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          ) : null}
        </div>

        {components.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {canFit
                ? "No parts on this unit yet. Use “Fit a part” at the top of the card — a part can also be recorded without a kind."
                : "No parts are recorded on this unit."}
            </p>
          </div>
        ) : (
          <ComponentsSection
            slug={company.slug}
            asset={asset}
            components={components}
            kinds={kinds}
            canEdit={canFit}
            canDelete={canEdit}
          />
        )}
      </section>
    </div>
  );
}
