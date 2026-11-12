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
import { NEW_ADDON_FORM_ID, type Addon, type AddonProduct } from "@/lib/addons";
import { getTenantContext } from "@/lib/auth";
import { isWorkspaceWritable } from "@/lib/billing/entitlements";
import { isSectionEnabled } from "@/lib/features";
import { canAdminister, canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { AddonDeck } from "./addon-deck";
import { AddonFields, type ScopeProduct } from "./addon-fields";

export const metadata: Metadata = {
  title: "Extras",
};

export default function AddOnsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/bookings/add-ons">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <AddOnsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AddOnsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/bookings/add-ons">["params"];
  searchParams: PageProps<"/[tenant]/bookings/add-ons">["searchParams"];
}) {
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  if (!isSectionEnabled(company, "bookings")) {
    notFound();
  }

  const writable = isWorkspaceWritable(company.subscription_status);
  // Reading the catalogue is for everyone — a viewer quoting a hire needs the
  // helmet price. Changing it is manager work, which is what the database's
  // policies say too.
  const canEdit = writable && canManage(role);

  const supabase = await createClient();

  // The product picker is only read when that section is on: with it off, RLS
  // returns nothing and the form simply has no scope block to render.
  const scopeOn = isSectionEnabled(company, "products");

  const [addonsResult, scopeResult, productsResult] = await Promise.all([
    supabase
      .from("addons")
      .select("*")
      .eq("company_id", company.id)
      .order("name", { ascending: true }),
    supabase
      .from("addon_products")
      .select("company_id, addon_id, product_id, created_at")
      .eq("company_id", company.id),
    scopeOn
      ? supabase
          .from("products")
          .select("id, title, parent_id")
          .eq("company_id", company.id)
          .order("title", { ascending: true })
      : Promise.resolve({ data: [] as ScopeProduct[] }),
  ]);

  const addons: Addon[] = addonsResult.data ?? [];
  const scope: AddonProduct[] = scopeResult.data ?? [];
  const products: ScopeProduct[] = productsResult.data ?? [];
  const active = addons.filter((addon) => addon.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Extras"
        description="What a hire can add on top of the unit: helmets, locks, a damage waiver. A line's extras follow the product it holds, and their price is fixed when they are added."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${company.slug}/bookings`}>Back to the board</Link>
            </Button>
            {canEdit ? (
              <FormSheet
                triggerLabel="New extra"
                title="New extra"
                description="A name, a price and how it is charged is enough. The products it goes with can be ticked here or later."
                formId={NEW_ADDON_FORM_ID}
                submitLabel="Add extra"
              >
                <FormMessage error={readParam(query.error)} />
                <AddonFields
                  slug={company.slug}
                  layout="panel"
                  formId={NEW_ADDON_FORM_ID}
                  products={products}
                  scopedProductIds={[]}
                  showSubmit={false}
                />
              </FormSheet>
            ) : null}
          </>
        }
      />

      {writable ? null : (
        <ReadOnlyNotice
          slug={company.slug}
          canManageBilling={canAdminister(role)}
        />
      )}

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <section aria-labelledby="extras-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="extras-heading" className="text-lg font-semibold tracking-tight">
            The catalogue
          </h2>
          <p className="text-muted-foreground text-sm">
            {addons.length === 0
              ? "Nothing on offer yet."
              : `${addons.length} extra${
                  addons.length === 1 ? "" : "s"
                }, ${active} on offer.`}
          </p>
        </div>

        {addons.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {canEdit
                ? "No extras yet. Use “New extra” at the top of the page — a hire works without them, and one can be added whenever the shop starts offering it."
                : "No extras yet. A manager can add them from this page."}
            </p>
          </div>
        ) : (
          <AddonDeck
            slug={company.slug}
            addons={addons}
            scope={scope}
            products={products}
            currency={company.currency}
            canEdit={canEdit}
          />
        )}
      </section>
    </div>
  );
}
