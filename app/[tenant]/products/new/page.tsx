import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth";
import {
  isWorkspaceWritable,
  READ_ONLY_MESSAGE,
} from "@/lib/billing/entitlements";
import { isSectionEnabled } from "@/lib/features";
import { canManage } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { ProductForm } from "../product-form";

export const metadata: Metadata = {
  title: "New product",
};

export default function NewProductPage({
  params,
}: PageProps<"/[tenant]/products/new">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <NewProductContent params={params} />
      </Suspense>
    </main>
  );
}

async function NewProductContent({
  params,
}: {
  params: PageProps<"/[tenant]/products/new">["params"];
}) {
  await connection();

  const { tenant } = await params;
  const { company, role } = await getTenantContext(tenant);

  // `notFound()` rather than a "you cannot do this" page: a viewer has nothing
  // to do here, and the action refuses the write regardless.
  if (!isSectionEnabled(company, "products") || !canManage(role)) {
    notFound();
  }

  // A read-only workspace has nothing to create here either, but a 404 would be
  // a lie. Send it to the catalogue, where the banner explains the freeze.
  if (!isWorkspaceWritable(company.subscription_status)) {
    redirect(
      `/${company.slug}/products?error=${encodeURIComponent(READ_ONLY_MESSAGE)}`,
    );
  }

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("company_id", company.id)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="New product"
        description="Add one product, then give it variants, stock and a gallery."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${company.slug}/products`}>Back to products</Link>
          </Button>
        }
      />

      <ProductForm
        slug={company.slug}
        categories={categories ?? []}
        defaultCurrency={company.currency}
      />
    </div>
  );
}
