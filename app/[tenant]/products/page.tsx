import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import { firstImagePerProduct } from "@/lib/product-media";
import {
  groupVariants,
  isProductStatus,
  NEW_PRODUCT_FORM_ID,
  PRODUCT_SORT_OPTIONS,
  PRODUCT_STATUS_OPTIONS,
  readProductSort,
} from "@/lib/products";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "../fields";
import { ProductDeck } from "./product-deck";
import { ProductFields } from "./product-fields";

export const metadata: Metadata = {
  title: "Products",
};

/** The default order, and the one the Reset link returns to. */
const DEFAULT_PRODUCT_SORT = PRODUCT_SORT_OPTIONS[0].value;

export default function ProductsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
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
  const sort = readProductSort(readParam(query.sort));

  const supabase = await createClient();

  // The category list feeds both the filter and the panel's picker, so it is
  // read once, in the same order the categories page shows them.
  const { data: categoryRows } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("company_id", company.id)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  // The filters and the order are applied in SQL rather than in JavaScript so a
  // long catalogue still renders in one request instead of loading every row
  // first.
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

  switch (sort) {
    case "title-desc":
      productQuery = productQuery.order("title", { ascending: false });
      break;
    case "newest":
      productQuery = productQuery.order("created_at", { ascending: false });
      break;
    case "price-asc":
      productQuery = productQuery
        .order("price_cents", { ascending: true })
        .order("title", { ascending: true });
      break;
    case "price-desc":
      productQuery = productQuery
        .order("price_cents", { ascending: false })
        .order("title", { ascending: true });
      break;
    default:
      productQuery = productQuery.order("title", { ascending: true });
  }

  const { data: productRows } = await productQuery;

  const families = groupVariants(productRows ?? []);
  const categories = categoryRows ?? [];
  const canEdit = canManage(role);
  const filtered = Boolean(status || categoryId);

  // Every row the deck can draw a picture for: the parents, plus their variants
  // — a family whose photos only live on one variant still gets a picture.
  const images = await firstImagePerProduct(
    supabase,
    company.id,
    families.flatMap((family) => [
      family.parent.id,
      ...family.variants.map((variant) => variant.id),
    ]),
  );

  const variantCount = families.reduce(
    (total, family) => total + family.variants.length,
    0,
  );
  const activeCount = families.filter(
    (family) => family.parent.status === "active",
  ).length;
  const summary =
    families.length === 0
      ? filtered
        ? "Nothing matches these filters."
        : "No products yet."
      : [
          `${families.length} product${families.length === 1 ? "" : "s"}`,
          variantCount > 0
            ? `${variantCount} variant${variantCount === 1 ? "" : "s"}`
            : null,
          `${activeCount} active`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Products"
        description="Everything this workspace sells: categories, variants, stock and gallery."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${company.slug}/products/categories`}>
                Categories
              </Link>
            </Button>
            {canEdit ? (
              <FormSheet
                triggerLabel="New product"
                title="New product"
                description="Start with the basics. Stock, variants, dates and media are added from the product page afterwards."
                formId={NEW_PRODUCT_FORM_ID}
                submitLabel="Create product"
              >
                {/* The error message belongs in the panel too: a failed submit
                    comes back to this page, and the panel would otherwise hide
                    the explanation it arrived with. */}
                <FormMessage error={readParam(query.error)} />
                <ProductFields
                  slug={company.slug}
                  categories={categories}
                  layout="panel"
                  formId={NEW_PRODUCT_FORM_ID}
                  surface="panel"
                  showSubmit={false}
                />
              </FormSheet>
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
        aria-label="Filter and sort the catalogue"
        className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,13rem)_minmax(0,11rem)_auto] sm:items-end"
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className={SELECT_CLASSES}
          >
            <option value="">Any status</option>
            {PRODUCT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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

        <label className="space-y-2 text-sm">
          <span className="font-medium">Sort</span>
          <select name="sort" defaultValue={sort} className={SELECT_CLASSES}>
            {PRODUCT_SORT_OPTIONS.map((option) => (
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
          {filtered || sort !== DEFAULT_PRODUCT_SORT ? (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/${company.slug}/products`}>Reset</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="catalogue-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="catalogue-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Catalogue
          </h2>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>

        {families.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {filtered
                ? "Nothing matches these filters."
                : canEdit
                  ? "No products yet. Use “New product” at the top of the page to add the first one — variants, stock and media follow on its own page."
                  : "No products yet. An owner, admin or manager can add the first one."}
            </p>
            {filtered ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${company.slug}/products`}>Clear filters</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ProductDeck
            slug={company.slug}
            families={families}
            images={images}
          />
        )}
      </section>
    </div>
  );
}
