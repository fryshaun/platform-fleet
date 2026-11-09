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
import {
  ASSET_STATUS_OPTIONS,
  availabilityLabel,
  isAssetStatus,
  summariseAssets,
  type Asset,
} from "@/lib/assets";
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "../fields";
import { AssetStatusBadge } from "./asset-badges";
import { AssetForm } from "./asset-form";

export const metadata: Metadata = {
  title: "Assets",
};

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

  const supabase = await createClient();

  let assetQuery = supabase
    .from("assets")
    .select("*")
    .eq("company_id", company.id);

  if (status) {
    assetQuery = assetQuery.eq("status", status);
  }

  const { data: assetRows } = await assetQuery
    .order("name", { ascending: true })
    .order("created_at", { ascending: true });

  // The product picker reads the catalogue, so it is only offered when the
  // products section is on. The fleet itself never depends on it: this page and
  // every policy work with the products section switched off.
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
  const canEdit = canManage(role);
  const filtered = Boolean(status);
  const labels = new Map(products.map((product) => [product.id, product.title]));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Assets"
        description="The individual units behind each product. Staff only — customers never see this page."
      />

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <form method="get" className="grid gap-3 sm:grid-cols-[14rem_auto] sm:items-end">
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

        <Button type="submit" variant="outline" className="self-end">
          Filter
        </Button>
      </form>

      <FleetCard
        slug={company.slug}
        assets={assets}
        labels={labels}
        filtered={filtered}
        canEdit={canEdit}
      />

      {canEdit ? <AssetForm slug={company.slug} products={products} /> : null}
    </div>
  );
}

function FleetCard({
  slug,
  assets,
  labels,
  filtered,
  canEdit,
}: {
  slug: string;
  assets: Asset[];
  labels: Map<string, string>;
  filtered: boolean;
  canEdit: boolean;
}) {
  const { total, outOfService } = summariseAssets(assets);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet</CardTitle>
        <CardDescription>
          {total === 0
            ? filtered
              ? "Nothing matches this filter."
              : "No assets yet."
            : `${total} unit${total === 1 ? "" : "s"} · ${availabilityLabel(assets)}${
                outOfService > 0 ? ` · ${outOfService} out of action` : ""
              }`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-muted-foreground text-sm">
            {canEdit
              ? "Add the first unit below. Availability is counted from these rows, so record one unit per bike, boat or room."
              : "An owner, admin or manager can add the first unit."}
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {assets.map((asset) => (
              <li key={asset.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/${slug}/assets/${asset.handle}`}
                      className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {asset.name}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      /{asset.handle}
                      {asset.serial ? ` · ${asset.serial}` : ""}
                      {asset.product_id
                        ? ` · ${labels.get(asset.product_id) ?? "Assigned to a product"}`
                        : " · Not assigned"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <AssetStatusBadge status={asset.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
