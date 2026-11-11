import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BrandLink } from "@/components/brand/brand-link";
import { CompanyForm } from "@/components/onboarding/company-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SubscriptionPlan } from "@/lib/plans";
import { readParam } from "@/lib/search-params";
import { listSubscriptionPlans } from "@/lib/subscriptions";

export const metadata: Metadata = {
  title: "Create your company",
};

export default function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <BrandLink logoClassName="text-xl" />

      <Suspense fallback={<Skeleton className="h-[30rem] w-full max-w-md rounded-xl" />}>
        <OnboardingPanel searchParams={searchParams} />
      </Suspense>

      <p className="text-muted-foreground text-sm">
        <Link href="/workspaces" className="underline">
          Back to your workspaces
        </Link>
      </p>
    </main>
  );
}

async function OnboardingPanel({
  searchParams,
}: {
  searchParams: PageProps<"/onboarding">["searchParams"];
}) {
  const params = await searchParams;
  const canceled = readParam(params.canceled) === "1";

  // The plans come from Stripe, so onboarding is the one page that cannot work
  // without it. Failing here is deliberate: creating a company we cannot bill
  // would strand it.
  let plans: SubscriptionPlan[] | null = null;
  try {
    plans = await listSubscriptionPlans();
  } catch (error) {
    console.error("Could not load the subscription plans:", error);
  }

  if (!plans || plans.length === 0) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Plans are unavailable</CardTitle>
          <CardDescription>
            {plans
              ? "No subscription plans are on sale right now. Please contact us."
              : "We could not reach Stripe to load the plans. Nothing was created — refresh in a moment to try again."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Name your company</CardTitle>
        <CardDescription>
          This becomes your workspace address. You can invite your team once the
          subscription is active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canceled ? (
          <p
            role="status"
            className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm"
          >
            Checkout was cancelled. Your company was created — you can pick up
            billing again from the workspace settings.
          </p>
        ) : null}

        <CompanyForm plans={plans} />
      </CardContent>
    </Card>
  );
}
