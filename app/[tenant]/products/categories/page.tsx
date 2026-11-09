import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Trash2Icon } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/actions/products";
import { getTenantContext } from "@/lib/auth";
import { isSectionEnabled } from "@/lib/features";
import type { ProductCategory } from "@/lib/products";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Product categories",
};

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

  const supabase = await createClient();

  const [{ data: categoryRows }, { data: productRows }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("*")
      .eq("company_id", company.id)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
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

  const categories = categoryRows ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Categories"
        description="Aisles for the catalogue. Flat on purpose: one level, ordered by the number you give."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${company.slug}/products`}>Back to products</Link>
          </Button>
        }
      />

      <FormMessage
        error={readParam(query.error)}
        success={readParam(query.ok)}
      />

      <Card>
        <CardHeader>
          <CardTitle>New category</CardTitle>
          <CardDescription>
            The address is derived from the name unless you set one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createCategory}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
          >
            <input type="hidden" name="slug" value={company.slug} />

            <div className="space-y-2">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                name="name"
                required
                maxLength={120}
                placeholder="Beverages"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category-position">Order</Label>
              <Input
                id="category-position"
                name="position"
                type="number"
                min={0}
                defaultValue={0}
              />
            </div>

            <Button type="submit">Add category</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            {categories.length === 0
              ? "No categories yet."
              : `${categories.length} categor${categories.length === 1 ? "y" : "ies"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Categories are optional — products can live without one.
            </p>
          ) : (
            <ul className="divide-border divide-y rounded-xl border">
              {categories.map((category) => (
                <li key={category.id} className="px-4 py-3">
                  <CategoryRow
                    slug={company.slug}
                    category={category}
                    productCount={counts.get(category.id) ?? 0}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryRow({
  slug,
  category,
  productCount,
}: {
  slug: string;
  category: ProductCategory;
  productCount: number;
}) {
  return (
    <div className="space-y-3">
      <form
        action={updateCategory}
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="category_id" value={category.id} />
        <input type="hidden" name="current_handle" value={category.handle} />

        <div className="space-y-2">
          <Label htmlFor={`category-name-${category.id}`}>Name</Label>
          <Input
            id={`category-name-${category.id}`}
            name="name"
            defaultValue={category.name}
            required
            maxLength={120}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`category-position-${category.id}`}>Order</Label>
          <Input
            id={`category-position-${category.id}`}
            name="position"
            type="number"
            min={0}
            defaultValue={category.position}
          />
        </div>

        <Button type="submit" size="sm" variant="outline">
          Save
        </Button>

        <div className="space-y-2 sm:col-span-3">
          <Input
            name="description"
            defaultValue={category.description ?? ""}
            aria-label={`Description for ${category.name}`}
            placeholder="Optional description"
            maxLength={400}
          />
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          /{category.handle} · {productCount} product
          {productCount === 1 ? "" : "s"}
        </p>

        <form action={deleteCategory}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="category_id" value={category.id} />
          <Button type="submit" size="sm" variant="ghost">
            <Trash2Icon aria-hidden="true" />
            Delete
          </Button>
        </form>
      </div>
    </div>
  );
}
