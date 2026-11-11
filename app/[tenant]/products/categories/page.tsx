import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import {
  CATEGORY_SORT_OPTIONS,
  categorySearchTerm,
  NEW_CATEGORY_FORM_ID,
  readCategorySort,
} from "@/lib/products";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { SELECT_CLASSES } from "../../fields";
import { CategoryDeck } from "./category-deck";
import { CategoryFields } from "./category-fields";

export const metadata: Metadata = {
  title: "Product categories",
};

/** The default order, and the one the Reset link returns to. */
const DEFAULT_CATEGORY_SORT = CATEGORY_SORT_OPTIONS[0].value;

export default function CategoriesPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products/categories">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <CategoriesContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CategoriesContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/products/categories">["params"];
  searchParams: PageProps<"/[tenant]/products/categories">["searchParams"];
}) {
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  // Categories are shop management, so this page is manager-only. Viewers still
  // read the category names on the product form and in the catalogue filter.
  if (!isSectionEnabled(company, "products") || !canManage(role)) {
    notFound();
  }

  const search = categorySearchTerm(readParam(query.q));
  const sort = readCategorySort(readParam(query.sort));

  const supabase = await createClient();

  // The search and the order are applied in SQL rather than in JavaScript, so a
  // long list still renders in one request. "Most products" is the exception:
  // the counts are derived below, so that order is applied once the rows are
  // here.
  let categoryQuery = supabase
    .from("product_categories")
    .select("*")
    .eq("company_id", company.id);

  if (search) {
    const pattern = `%${search}%`;
    categoryQuery = categoryQuery.or(
      `name.ilike.${pattern},handle.ilike.${pattern}`,
    );
  }

  switch (sort) {
    case "name":
      categoryQuery = categoryQuery.order("name", { ascending: true });
      break;
    case "name-desc":
      categoryQuery = categoryQuery.order("name", { ascending: false });
      break;
    case "busiest":
      break;
    default:
      categoryQuery = categoryQuery
        .order("position", { ascending: true })
        .order("name", { ascending: true });
  }

  const [{ data: categoryRows }, { data: productRows }] = await Promise.all([
    categoryQuery,
    supabase
      .from("products")
      .select("category_id")
      .eq("company_id", company.id),
  ]);

  // Counted here rather than with a `group by`, which PostgREST cannot express
  // without an RPC. The payload is one uuid per product, so this stays cheap.
  const counts = new Map<string, number>();
  for (const row of productRows ?? []) {
    if (!row.category_id) continue;
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  const categories = [...(categoryRows ?? [])];

  if (sort === "busiest") {
    // Ties fall back to the shelf order, then the name, so the deck does not
    // reshuffle between requests.
    categories.sort(
      (a, b) =>
        (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
        a.position - b.position ||
        a.name.localeCompare(b.name),
    );
  }

  const productTotal = productRows?.length ?? 0;
  const listed = categories.reduce(
    (total, category) => total + (counts.get(category.id) ?? 0),
    0,
  );
  const categorised = Array.from(counts.values()).reduce(
    (total, count) => total + count,
    0,
  );
  const uncategorised = productTotal - categorised;
  const filtered = Boolean(search);

  // What is on screen first, then the catalogue-wide fact an aisle list is for:
  // how much of the shop still has no aisle yet.
  const summary =
    categories.length === 0
      ? filtered
        ? "Nothing matches this search."
        : "No categories yet."
      : [
          `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
          `${listed} product${listed === 1 ? "" : "s"}`,
          !filtered && uncategorised > 0 ? `${uncategorised} uncategorised` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Categories"
        description="Aisles for the catalogue. Flat on purpose: one level, ordered by the number you give."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${company.slug}/products`}>Back to products</Link>
            </Button>
            <FormSheet
              triggerLabel="New category"
              title="New category"
              description="A name and an order is enough. Products are filed here from their own page afterwards."
              formId={NEW_CATEGORY_FORM_ID}
              submitLabel="Add category"
            >
              {/* The error message belongs in the panel too: a failed submit
                  comes back to this page, and the panel would otherwise hide
                  the explanation it arrived with. */}
              <FormMessage error={readParam(query.error)} />
              <CategoryFields
                slug={company.slug}
                layout="panel"
                formId={NEW_CATEGORY_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          </>
        }
      />

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <form
        method="get"
        aria-label="Search and sort the categories"
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto] sm:items-end"
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Search</span>
          <Input
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="Name or address"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Sort</span>
          <select name="sort" defaultValue={sort} className={SELECT_CLASSES}>
            {CATEGORY_SORT_OPTIONS.map((option) => (
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
          {search || sort !== DEFAULT_CATEGORY_SORT ? (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/${company.slug}/products/categories`}>Reset</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="aisles-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="aisles-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Aisles
          </h2>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>

        {categories.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              {filtered
                ? "Nothing matches this search."
                : "No categories yet. Use “New category” at the top of the page — categories are optional, and a product can live without one."}
            </p>
            {filtered ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${company.slug}/products/categories`}>
                  Clear search
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <CategoryDeck
            slug={company.slug}
            categories={categories}
            counts={counts}
          />
        )}
      </section>
    </div>
  );
}
