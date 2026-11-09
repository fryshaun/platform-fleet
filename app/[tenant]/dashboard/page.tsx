import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageSkeleton } from "@/components/tenant/page-header";
import { getTenantContext } from "@/lib/auth";
import { canAdminister, roleLabel } from "@/lib/roles";
import {
  isSubscriptionActive,
  needsReconciliation,
  reconcileCompanySubscription,
} from "@/lib/billing/sync";
import { readParam } from "@/lib/search-params";
import type { SubscriptionStatus } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/dashboard">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton />}>
        <DashboardContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function DashboardContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/dashboard">["params"];
  searchParams: PageProps<"/[tenant]/dashboard">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);

  const { company: stored, role, user } = await getTenantContext(tenant);

  // Straight after checkout the row can still read as unpaid: Stripe has taken
  // the payment but the webhook may not have landed. Re-reading means a paying
  // customer never lands on "subscription incomplete". On any later visit the
  // row has settled and this costs no API call.
  const company = needsReconciliation(stored)
    ? (await reconcileCompanySubscription(stored)).company
    : stored;

  const justCheckedOut = readParam(query.checkout) === "success";
  const firstName = user.fullName?.split(/\s+/)[0] ?? user.email.split("@")[0];
  const isAdmin = canAdminister(role);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6 lg:p-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, {firstName}
          </h1>
          <Badge variant="secondary">{roleLabel(role)}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {company.name} · <span className="font-mono">/{company.slug}</span>
        </p>
      </header>

      <BillingNotice
        slug={company.slug}
        status={company.subscription_status}
        justCheckedOut={justCheckedOut}
        canManageBilling={isAdmin}
      />

      <Card>
        <CardHeader>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            This workspace is the base every feature module builds on: sign-in,
            members and roles, RLS-scoped data and billing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-muted-foreground space-y-2 text-sm">
            <li>Invite your team and choose a role for each person.</li>
            <li>Review the plan and the payment details on file.</li>
            <li>
              Add the first section for this workspace — see “Adding a new
              section” in the README.
            </li>
          </ul>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href={`/${company.slug}/settings`}>Manage team</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/${company.slug}/settings/billing`}>
                  Review billing
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              An owner or admin can invite teammates and change the plan.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BillingNotice({
  slug,
  status,
  justCheckedOut,
  canManageBilling,
}: {
  slug: string;
  status: SubscriptionStatus;
  justCheckedOut: boolean;
  canManageBilling: boolean;
}) {
  const active = isSubscriptionActive(status);

  if (active) {
    return justCheckedOut ? (
      <Card className="border-emerald-600/30 bg-emerald-500/5">
        <CardContent className="py-1 text-sm">
          Subscription active — your workspace is ready. Welcome aboard.
        </CardContent>
      </Card>
    ) : null;
  }

  return (
    <Card className="border-amber-600/30 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {justCheckedOut
              ? "Finishing your subscription…"
              : "Your subscription is not active yet"}
          </p>
          <p className="text-muted-foreground text-xs">
            Complete billing to finish setting up this workspace ({status}).
          </p>
        </div>
        {canManageBilling ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/${slug}/settings/billing`}>Go to billing</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

