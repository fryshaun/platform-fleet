import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import {
  ASSET_SORT_OPTIONS,
  ASSET_STATUS_OPTIONS,
  availabilityLabel,
  isAssetStatus,
  NEW_ASSET_FORM_ID,
  readAssetSort,
  summariseAssets,
} from "@/lib/assets";
import { getTenantContext } from "@/lib/auth";
import { isWorkspaceWritable } from "@/lib/billing/entitlements";
import { isSectionEnabled } from "@/lib/features";
import { firstImagePerProduct } from "@/lib/product-media";
import { canAdminister, canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "../fields";
import { AssetDeck } from "./asset-deck";
import { AssetFields } from "./asset-fields";

export const metadata: Metadata = {
  title: "Assets",
};

/** The default order, and the one the Reset link returns to. */
const DEFAULT_ASSET_SORT = ASSET_SORT_OPTIONS[0].value;

export default function AssetsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <AssetsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AssetsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets">["params"];
  searchParams: PageProps<"/[tenant]/assets">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  // A section that is switched off does not exist for this workspace — not even
  // its URL. RLS enforces the same thing on the data itself.
  if (!isSectionEnabled(company, "assets")) {
    notFound();
  }

  const statusParam = readParam(query.status);
  const status = statusParam && isAssetStatus(statusParam) ? statusParam : null;
  const sort = readAssetSort(readParam(query.sort));

  const supabase = await createClient();

  // The filter and the order are applied in SQL rather than in JavaScript so a
  // large fleet still renders in one request instead of loading every row first.
  let assetQuery = supabase
    .from("assets")
    .select("*")
    .eq("company_id", company.id);

  if (status) {
    assetQuery = assetQuery.eq("status", status);
  }

  switch (sort) {
    case "name-desc":
      assetQuery = assetQuery.order("name", { ascending: false });
      break;
    case "newest":
      assetQuery = assetQuery.order("created_at", { ascending: false });
      break;
    case "status":
      assetQuery = assetQuery
        .order("status", { ascending: true })
        .order("name", { ascending: true });
      break;
    default:
      assetQuery = assetQuery
        .order("name", { ascending: true })
        .order("created_at", { ascending: true });
  }

  const { data: assetRows } = await assetQuery;

  // The product picker and the card images both read the catalogue, so neither
  // is offered when the products section is off. The fleet itself never depends
  // on it: this page and every policy work with the products section switched
  // off.
  const products = isSectionEnabled(company, "products")
    ? (
        await supabase
          .from("products")
          .select("id, title, handle")
          .eq("company_id", company.id)
          .order("title", { ascending: true })
      ).data ?? []
    : [];

  const assets = assetRows ?? [];
  const images = await firstImagePerProduct(
    supabase,
    company.id,
    assets.map((asset) => asset.product_id),
  );

  // The fleet stays on screen when a subscription lapses — reads are never
  // gated — but the create affordances go with the writes: `canEdit` is what
  // the header action and the empty state check, so nothing offers a form whose
  // action would refuse it. The banner says why.
  const writable = isWorkspaceWritable(company.subscription_status);
  const canEdit = canManage(role) && writable;
  const filtered = Boolean(status);
  const productTitles = new Map(
    products.map((product) => [product.id, product.title]),
  );

  const { total, outOfService, retired } = summariseAssets(assets);
  const summary =
    total === 0
      ? filtered
        ? "Nothing matches this filter."
        : "No units recorded yet."
      : [
          `${total} unit${total === 1 ? "" : "s"}`,
          availabilityLabel(assets),
          outOfService > 0 ? `${outOfService} out of action` : null,
          retired > 0 ? `${retired} retired` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Assets"
        description="The individual units behind each product. Staff only — customers never see this page."
        actions={
          canEdit ? (
            <FormSheet
              triggerLabel="New asset"
              title="New asset"
              description="One row per physical unit — a bike, a boat, a room. It is linked to a product so its name, image and stock come from the catalogue."
              formId={NEW_ASSET_FORM_ID}
              submitLabel="Add asset"
            >
              {/* The error message belongs in the panel too: a failed submit
                  comes back to this page, and the panel would otherwise hide
                  the explanation it arrived with. */}
              <FormMessage error={readParam(query.error)} />
              <AssetFields
                slug={company.slug}
                products={products}
                layout="panel"
                formId={NEW_ASSET_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          ) : undefined
        }
      />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <form
        method="get"
        aria-label="Filter and sort the fleet"
        className="grid gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto] sm:items-end"
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Any status</option>
            {ASSET_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Sort</span>
          <select name="sort" defaultValue={sort} className={SELECT_CLASSES}>
            {ASSET_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {status || sort !== DEFAULT_ASSET_SORT ? (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/${company.slug}/assets`}>Reset</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="fleet-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="fleet-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Fleet
          </h2>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>

        {assets.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {filtered
                ? "Nothing matches this filter."
                : canEdit
                  ? "No assets yet. Use “New asset” at the top of the page to record the first unit — one row per bike, boat or room."
                  : "No assets yet. An owner, admin or manager can add the first unit."}
            </p>
            {filtered ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${company.slug}/assets`}>Clear filter</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <AssetDeck
            slug={company.slug}
            assets={assets}
            images={images}
            productTitles={productTitles}
          />
        )}
      </section>
    </div>
  );
}
