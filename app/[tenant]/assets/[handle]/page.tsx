import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
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
import { deleteAsset, setAssetStatus } from "@/lib/actions/assets";
import {
  ASSET_STATUS_OPTIONS,
  formatStatusChanged,
  type Asset,
} from "@/lib/assets";
import { isSectionEnabled } from "@/lib/features";
import { canAdminister } from "@/lib/roles";
import { readParam } from "@/lib/search-params";

import { requireAssetPage } from "../asset-access";
import { AssetForm } from "../asset-form";
import { AssetHeader } from "../asset-header";

export const metadata: Metadata = {
  title: "Asset",
};

export default function AssetPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets/[handle]">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <AssetContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * The overview tab: availability, the editable record, and removal.
 *
 * The unit page is a screen split into tabs (see `lib/assets.ts`), and this is
 * the one the URL without a segment has always meant. The components that hang
 * off the unit, the usage log and the service state are their own tabs, because
 * each of them is a list that grows.
 */
async function AssetContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets/[handle]">["params"];
  searchParams: PageProps<"/[tenant]/assets/[handle]">["searchParams"];
}) {
  const [{ tenant, handle }, query] = await Promise.all([params, searchParams]);
  const { company, role, asset, supabase, writable, canUpdateStatus, canEdit } =
    await requireAssetPage(tenant, handle);

  // The picker and the product name both come from the catalogue, so neither is
  // read when the products section is off — RLS would return nothing anyway.
  const products = isSectionEnabled(company, "products")
    ? ((
        await supabase
          .from("products")
          .select("id, title, handle")
          .eq("company_id", company.id)
          .order("title", { ascending: true })
      ).data ?? [])
    : [];

  const product = asset.product_id
    ? products.find((row) => row.id === asset.product_id) ?? null
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <AssetHeader slug={company.slug} asset={asset} current="overview" />

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

      <AvailabilityCard
        slug={company.slug}
        asset={asset}
        product={product}
        canUpdateStatus={canUpdateStatus}
      />

      {canEdit ? (
        <AssetForm slug={company.slug} products={products} asset={asset} />
      ) : null}

      {canEdit ? <RemovalCard slug={company.slug} asset={asset} /> : null}
    </div>
  );
}


/**
 * Availability, and the buttons that change it.
 *
 * This is the card the front desk uses, so it is not behind the manager tier:
 * marking a unit out of action is the whole point of the section. Editing the
 * record below it still is.
 */
function AvailabilityCard({
  slug,
  asset,
  product,
  canUpdateStatus,
}: {
  slug: string;
  asset: Asset;
  product: { title: string; handle: string } | null;
  canUpdateStatus: boolean;
}) {
  const others = ASSET_STATUS_OPTIONS.filter(
    (option) => option.value !== asset.status,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability</CardTitle>
        <CardDescription>
          {asset.status === "available"
            ? "In service, and counted in what this workspace can promise."
            : asset.status === "in_workshop"
              ? "Out of action, and excluded from what this workspace can promise until it is marked available again."
              : asset.status === "rented"
                ? "Out on hire. It counts as bookable again when the booking that holds it is completed or cancelled."
                : "Retired from the fleet. Kept so its history stays readable, and never booked."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Product</dt>
            <dd>
              {product ? (
                <Link
                  href={`/${slug}/products/${product.handle}`}
                  className="underline underline-offset-4"
                >
                  {product.title}
                </Link>
              ) : asset.product_id ? (
                "Assigned to a product"
              ) : (
                "Not assigned"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              Last status change
            </dt>
            <dd>{formatStatusChanged(asset.status_changed_at)}</dd>
          </div>
        </dl>

        {asset.status === "rented" ? (
          // The buttons would all be refused by `setAssetStatus()`, which is the
          // right rule — a hire owns the unit until it comes back — so the card
          // says why instead of offering three writes that cannot happen.
          <p className="text-muted-foreground text-sm">
            The booking holding this unit sets its status. Complete or cancel the
            booking to bring it back into the fleet.
          </p>
        ) : canUpdateStatus ? (
          <div className="flex flex-wrap items-end gap-2">
            {others.map((option) => (
              <form key={option.value} action={setAssetStatus}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="asset_id" value={asset.id} />
                <input
                  type="hidden"
                  name="current_handle"
                  value={asset.handle}
                />
                <input type="hidden" name="status" value={option.value} />
                <Button type="submit" size="sm" variant="outline">
                  Mark {option.label.toLowerCase()}
                </Button>
              </form>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            A staff member, manager, admin or owner can change availability.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Removing a unit for good. Retiring it is the softer, reversible option. */
function RemovalCard({ slug, asset }: { slug: string; asset: Asset }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Removal</CardTitle>
        <CardDescription>
          Deleting removes the unit and its record. Mark it retired instead if you
          may want to look back at it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={deleteAsset}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="asset_id" value={asset.id} />
          <input type="hidden" name="current_handle" value={asset.handle} />
          <Button type="submit" size="sm" variant="destructive">
            Delete asset
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
