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
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import {
  familyPriceLabel,
  groupVariants,
  isProductStatus,
  type Product,
  type ProductFamily,
} from "@/lib/products";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "./fields";
import { ProductStatusBadge, StockBadge } from "./product-badges";

export const metadata: Metadata = {
  title: "Products",
};

export default function ProductsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton />}>
        <ProductsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProductsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/products">["params"];
  searchParams: PageProps<"/[tenant]/products">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  // A section that is switched off does not exist for this workspace — not even
  // its URL. RLS enforces the same thing on the data itself.
  if (!isSectionEnabled(company, "products")) {
    notFound();
  }

  const statusParam = readParam(query.status);
  const status =
    statusParam && isProductStatus(statusParam) ? statusParam : null;
  const categoryId = readParam(query.category) || null;

  const supabase = await createClient();

  const { data: categoryRows } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("company_id", company.id)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  // The filters are applied in SQL rather than in JavaScript so a long catalogue
  // still renders in one request instead of loading every row first.
  let productQuery = supabase
    .from("products")
    .select("*")
    .eq("company_id", company.id);

  if (status) {
    productQuery = productQuery.eq("status", status);
  }
  if (categoryId) {
    productQuery = productQuery.eq("category_id", categoryId);
  }

  const { data: productRows } = await productQuery.order("title", {
    ascending: true,
  });

  const families = groupVariants(productRows ?? []);
  const categories = categoryRows ?? [];
  const canEdit = canManage(role);
  const filtered = Boolean(status || categoryId);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Products"
        description="Everything this workspace sells: categories, variants, stock and gallery."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${company.slug}/products/categories`}>
                Categories
              </Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link href={`/${company.slug}/products/new`}>New product</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <form
        method="get"
        className="grid gap-3 sm:grid-cols-[10rem_14rem_auto] sm:items-end"
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Category</span>
          <select
            name="category"
            defaultValue={categoryId ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Any category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <CatalogueCard
        slug={company.slug}
        families={families}
        canEdit={canEdit}
        filtered={filtered}
      />
    </div>
  );
}

function CatalogueCard({
  slug,
  families,
  canEdit,
  filtered,
}: {
  slug: string;
  families: ProductFamily[];
  canEdit: boolean;
  filtered: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Catalogue</CardTitle>
        <CardDescription>
          {families.length === 0
            ? filtered
              ? "Nothing matches these filters."
              : "No products yet."
            : `${families.length} product${families.length === 1 ? "" : "s"} in this workspace.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {families.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {canEdit ? (
              <>
                <Link
                  href={`/${slug}/products/new`}
                  className="text-foreground underline underline-offset-4"
                >
                  Add the first product
                </Link>{" "}
                to start the catalogue.
              </>
            ) : (
              "An owner, admin or manager can add the first product."
            )}
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {families.map((family) => (
              <li key={family.parent.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/${slug}/products/${family.parent.handle}`}
                      className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {family.parent.title}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      /{family.parent.handle} · {familyPriceLabel(family)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <ProductStatusBadge status={family.parent.status} />
                    <StockBadge product={family.parent} />
                  </div>
                </div>

                {family.variants.length > 0 ? (
                  <ul className="text-muted-foreground mt-2 space-y-1 border-l pl-3 text-xs">
                    {family.variants.map((variant) => (
                      <li key={variant.id}>
                        <VariantLine slug={slug} variant={variant} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function VariantLine({ slug, variant }: { slug: string; variant: Product }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link
        href={`/${slug}/products/${variant.handle}`}
        className="truncate underline-offset-4 hover:underline"
      >
        {variant.title}
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <ProductStatusBadge status={variant.status} />
        <StockBadge product={variant} />
      </div>
    </div>
  );
}
