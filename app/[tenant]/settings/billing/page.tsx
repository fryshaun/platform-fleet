import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PlanPicker } from "@/components/billing/plan-picker";
import { FormMessage } from "@/components/form-message";
import { PageHeader, PageSkeleton } from "@/components/tenant/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  openBillingPortal,
  startSubscriptionCheckout,
} from "@/lib/actions/billing";
import { getTenantContext } from "@/lib/auth";
import { canAdminister } from "@/lib/roles";
import {
  hasLiveSubscription,
  isSubscriptionActive,
  reconcileCompanySubscription,
} from "@/lib/billing/sync";
import { formatStripePrice, type SubscriptionPlan } from "@/lib/plans";
import { readParam } from "@/lib/search-params";
import { listSubscriptionPlans } from "@/lib/subscriptions";

export const metadata: Metadata = {
  title: "Billing",
};

export default function BillingPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/billing">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <BillingContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BillingContent({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings/billing">["params"];
  searchParams: PageProps<"/[tenant]/settings/billing">["searchParams"];
}) {
  // Creating the client starts `auth-js`' session recovery, which reads the
  // current time. Render at request time so that read does not happen while
  // prerendering, where it is reported as an unstable value.
  await connection();

  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company: stored, role } = await getTenantContext(tenant);

  if (!canAdminister(role)) {
    notFound();
  }

  // Stripe is the source of truth, so the stored row is re-read on every visit.
  // A webhook delivery that never arrived can then only make this page stale for
  // as long as nobody looks at it.
  const { company, subscription } = await reconcileCompanySubscription(stored);

  const active = isSubscriptionActive(company.subscription_status);
  const needsPayment = hasLiveSubscription(company.subscription_status) && !active;

  // The catalogue is only needed to start a new subscription, so a company that
  // is already paying does not pay for the extra Stripe round trip.
  let plans: SubscriptionPlan[] = [];
  if (!hasLiveSubscription(company.subscription_status)) {
    try {
      plans = await listSubscriptionPlans();
    } catch (error) {
      console.error("Could not load the subscription plans:", error);
    }
  }

  const currentPrice = subscription ? (subscription.items.data[0]?.price ?? null) : null;
  const currentPriceLabel = currentPrice ? formatStripePrice(currentPrice) : null;

  const justCheckedOut = readParam(query.checkout) === "success";
  const success =
    readParam(query.ok) ??
    (justCheckedOut && active
      ? "Checkout complete — your subscription is active."
      : undefined);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-10">
      <PageHeader
        title="Billing"
        description="Your subscription, invoices and payment method."
        actions={
          <Button variant="ghost" asChild>
            <Link href={`/${company.slug}/settings`}>Back to settings</Link>
          </Button>
        }
      />

      <FormMessage error={readParam(query.error)} success={success} />

      {justCheckedOut && !active ? (
        <p
          role="status"
          className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm"
        >
          Stripe is still confirming your subscription. This page reads the
          latest state every time it loads, so refresh in a moment.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Subscription
            <Badge variant={active ? "secondary" : "outline"}>
              {company.subscription_status}
            </Badge>
          </CardTitle>
          <CardDescription>
            {active
              ? "Your workspace is fully enabled."
              : needsPayment
                ? "Your subscription needs attention in the billing portal."
                : "Complete billing to unlock the full workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Company</dt>
              <dd className="font-medium">{company.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Plan</dt>
              <dd className="font-medium">{currentPriceLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Stripe customer</dt>
              <dd className="font-mono text-xs break-all">
                {company.stripe_customer_id ?? "Not created yet"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Subscription</dt>
              <dd className="font-mono text-xs break-all">
                {company.stripe_subscription_id ?? "None"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Trial ends</dt>
              <dd>
                {company.trial_ends_at
                  ? new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(company.trial_ends_at))
                  : "—"}
              </dd>
            </div>
          </dl>

          {plans.length > 0 ? (
            <form action={startSubscriptionCheckout} className="space-y-4">
              <input type="hidden" name="slug" value={company.slug} />
              <PlanPicker plans={plans} defaultPriceId={currentPrice?.id ?? null} />
              <Button type="submit">Subscribe</Button>
            </form>
          ) : null}

          {company.stripe_customer_id ? (
            <form action={openBillingPortal}>
              <input type="hidden" name="slug" value={company.slug} />
              <Button type="submit" variant={active ? "outline" : "default"}>
                {active ? "Manage subscription" : "Manage or resume subscription"}
              </Button>
            </form>
          ) : null}

          <p className="text-muted-foreground text-xs leading-relaxed">
            Payment methods, invoices and cancellation live in the Stripe billing
            portal. Status changes arrive through the Stripe webhook, and this
            page re-reads the subscription whenever it loads.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
