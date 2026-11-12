import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { FormSheet } from "@/components/tenant/form-sheet";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth";
import {
  isWorkspaceWritable,
  READ_ONLY_MESSAGE,
} from "@/lib/billing/entitlements";
import { NEW_KIND_FORM_ID } from "@/lib/components";
import { isSectionEnabled } from "@/lib/features";
import { canManage } from "@/lib/roles";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { KindDeck } from "./kind-deck";
import { KindFields } from "./kind-fields";

export const metadata: Metadata = {
  title: "Component kinds",
};

/**
 * The fleet's parts taxonomy: the kinds a component can be, and how often each
 * one is serviced.
 *
 * This is shop management, so it is manager-only and hidden from the rail for
 * everyone else — the same tier as the product categories, and the same split
 * migration 18's policies make (naming a kind is a manager's, fitting a part is
 * the front desk's).
 *
 * The intervals live here rather than on each part so that "every 50 hours"
 * means one thing across the whole fleet. `/assets/kinds` is reserved in
 * `RESERVED_ASSET_HANDLES`, so no unit can shadow this page.
 */
export default function KindsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/assets/kinds">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <KindsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function KindsContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/assets/kinds">["params"];
  searchParams: PageProps<"/[tenant]/assets/kinds">["searchParams"];
}) {
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company, role } = await getTenantContext(tenant);

  if (!isSectionEnabled(company, "assets") || !canManage(role)) {
    notFound();
  }

  // Nothing on this page can be written in a read-only workspace, so it has no
  // reason to exist: the fleet keeps the kind names on its filters and forms,
  // and the banner there explains why the forms are gone.
  if (!isWorkspaceWritable(company.subscription_status)) {
    redirect(
      `/${company.slug}/assets?error=${encodeURIComponent(READ_ONLY_MESSAGE)}`,
    );
  }

  const supabase = await createClient();

  const [{ data: kindRows }, { data: componentRows }] = await Promise.all([
    supabase
      .from("component_kinds")
      .select("*")
      .eq("company_id", company.id)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("asset_components")
      .select("kind_id")
      .eq("company_id", company.id),
  ]);

  // Counted here rather than with a `group by`, which PostgREST cannot express
  // without an RPC. One uuid per part keeps the payload small.
  const counts = new Map<string, number>();
  let unclassified = 0;
  for (const row of componentRows ?? []) {
    if (!row.kind_id) {
      unclassified += 1;
      continue;
    }
    counts.set(row.kind_id, (counts.get(row.kind_id) ?? 0) + 1);
  }

  const kinds = kindRows ?? [];
  const classified = Array.from(counts.values()).reduce(
    (total, count) => total + count,
    0,
  );

  const summary =
    kinds.length === 0
      ? "No kinds yet."
      : [
          `${kinds.length} kind${kinds.length === 1 ? "" : "s"}`,
          `${classified} part${classified === 1 ? "" : "s"} classified`,
          unclassified > 0 ? `${unclassified} with no kind` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Component kinds"
        description="What a part can be, and how often it is serviced. An interval is set here once and applies to every part of that kind."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${company.slug}/assets`}>Back to fleet</Link>
            </Button>
            <FormSheet
              triggerLabel="New kind"
              title="New kind"
              description="A name and, if it is serviced on a schedule, one or more intervals. Parts are filed under a kind from their unit page."
              formId={NEW_KIND_FORM_ID}
              submitLabel="Add kind"
            >
              {/* The error message belongs in the panel too: a failed submit
                  comes back to this page, and the panel would otherwise hide
                  the explanation it arrived with. */}
              <FormMessage error={readParam(query.error)} />
              <KindFields
                slug={company.slug}
                layout="panel"
                formId={NEW_KIND_FORM_ID}
                showSubmit={false}
              />
            </FormSheet>
          </>
        }
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <section aria-labelledby="kinds-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="kinds-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Kinds
          </h2>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>

        {kinds.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            <p>
              No kinds yet. Use “New kind” at the top of the page — kinds are
              optional, and a part can be named without one.
            </p>
          </div>
        ) : (
          <KindDeck slug={company.slug} kinds={kinds} counts={counts} />
        )}
      </section>
    </div>
  );
}
