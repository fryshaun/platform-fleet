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
import { deleteProduct, setProductStatus } from "@/lib/actions/products";
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import {
  formatProductPrice,
  PRODUCT_KIND_LABELS,
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_OPTIONS,
  type Product,
} from "@/lib/products";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { ProductStatusBadge, StockBadge } from "../product-badges";
import { ProductForm } from "../product-form";
import { AssetsSection } from "./assets-section";
import { DatesSection } from "./dates-section";
import { GallerySection } from "./gallery-section";
import { InventorySection } from "./inventory-section";
import { VariantsSection } from "./variants-section";

export const metadata: Metadata = {
  title: "Product",
};

export default function ProductPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products/[handle]">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <ProductContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProductContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/products/[handle]">["params"];
  searchParams: PageProps<"/[tenant]/products/[handle]">["searchParams"];
}) {
  await connection();

  const [{ tenant, handle }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  if (!isSectionEnabled(company, "products")) {
    notFound();
  }

  const supabase = await createClient();

  // Scoped by company as well as by handle: a handle is only unique inside a
  // workspace, so this also keeps one tenant's product out of another's URL.
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("company_id", company.id)
    .eq("handle", handle)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  const canEdit = canManage(role);

  const [
    { data: categories },
    { data: variantRows },
    { data: mediaRows },
    { data: dateRows },
    parentResult,
  ] = await Promise.all([
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("company_id", company.id)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .eq("company_id", company.id)
      .eq("parent_id", product.id)
      .order("title", { ascending: true }),
    supabase
      .from("product_media")
      .select("*")
      .eq("company_id", company.id)
      .eq("product_id", product.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("product_dates")
      .select("*")
      .eq("company_id", company.id)
      .eq("product_id", product.id)
      .order("starts_on", { ascending: true }),
    product.parent_id
      ? supabase
          .from("products")
          .select("id, title, handle")
          .eq("id", product.parent_id)
          .eq("company_id", company.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const parent = parentResult.data;
  const categoryName =
    (categories ?? []).find((category) => category.id === product.category_id)
      ?.name ?? null;

  // The assets section is optional and independent: when it is off this query is
  // never made, and the card below is never rendered.
  const assetsEnabled = isSectionEnabled(company, "assets");
  const assetRows = assetsEnabled
    ? (
        await supabase
          .from("assets")
          .select("*")
          .eq("company_id", company.id)
          .eq("product_id", product.id)
          .order("name", { ascending: true })
      ).data ?? []
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title={product.title}
        description={`/${product.handle} · ${formatProductPrice(product)} · ${
          PRODUCT_KIND_LABELS[product.kind]
        }${categoryName ? ` · ${categoryName}` : ""}`}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${company.slug}/products`}>All products</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ProductStatusBadge status={product.status} />
        <StockBadge product={product} />
        {parent ? (
          <span className="text-muted-foreground text-xs">
            Variant of{" "}
            <Link
              href={`/${company.slug}/products/${parent.handle}`}
              className="text-foreground underline underline-offset-4"
            >
              {parent.title}
            </Link>
          </span>
        ) : null}
      </div>

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      {canEdit ? (
        <ProductForm
          slug={company.slug}
          categories={categories ?? []}
          product={product}
        />
      ) : (
        <ReadOnlyDetails product={product} categoryName={categoryName} />
      )}

      <InventorySection
        slug={company.slug}
        product={product}
        canEdit={canEdit}
      />

      {assetsEnabled ? (
        <AssetsSection slug={company.slug} assets={assetRows} />
      ) : null}

      <DatesSection
        slug={company.slug}
        product={product}
        dates={dateRows ?? []}
        canEdit={canEdit}
      />

      <VariantsSection
        slug={company.slug}
        product={product}
        variants={variantRows ?? []}
        canEdit={canEdit}
      />

      <GallerySection
        slug={company.slug}
        productId={product.id}
        handle={product.handle}
        items={(mediaRows ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          alt: row.alt,
          url:
            row.url ??
            (row.storage_path
              ? supabase.storage
                  .from(PRODUCT_MEDIA_BUCKET)
                  .getPublicUrl(row.storage_path).data.publicUrl
              : null),
        }))}
        canEdit={canEdit}
      />

      {canEdit ? <StatusCard slug={company.slug} product={product} /> : null}
    </div>
  );
}

/** What a viewer sees instead of the edit form. */
function ReadOnlyDetails({
  product,
  categoryName,
}: {
  product: Product;
  categoryName: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          An owner, admin or manager can change these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Price</dt>
            <dd className="font-medium">{formatProductPrice(product)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Compare at</dt>
            <dd>
              {product.compare_at_price_cents === null
                ? "—"
                : formatProductPrice({
                    ...product,
                    price_cents: product.compare_at_price_cents,
                  })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">SKU</dt>
            <dd>{product.sku ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Supplier</dt>
            <dd>{product.supplier ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Category</dt>
            <dd>{categoryName ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground text-xs">Description</dt>
            <dd className="whitespace-pre-line">
              {product.description ?? "—"}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Publishing, archiving and deleting — the buttons nobody presses by accident. */
function StatusCard({ slug, product }: { slug: string; product: Product }) {
  const others = PRODUCT_STATUS_OPTIONS.filter(
    (option) => option.value !== product.status,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status and removal</CardTitle>
        <CardDescription>
          Currently {PRODUCT_STATUS_LABELS[product.status].toLowerCase()}. Only
          active products belong in a storefront.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        {others.map((option) => (
          <form key={option.value} action={setProductStatus}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="current_handle" value={product.handle} />
            <input type="hidden" name="status" value={option.value} />
            <Button type="submit" size="sm" variant="outline">
              Mark {option.label.toLowerCase()}
            </Button>
          </form>
        ))}

        <form action={deleteProduct}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="product_id" value={product.id} />
          <input type="hidden" name="current_handle" value={product.handle} />
          <Button type="submit" size="sm" variant="destructive">
            Delete product
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
