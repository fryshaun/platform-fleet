import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignInCard } from "@/components/auth/sign-in-card";
import { BrandLink } from "@/components/brand/brand-link";
import { Skeleton } from "@/components/ui/skeleton";
import { readParam } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Create a company",
};

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <BrandLink logoClassName="text-xl" />

      <Suspense
        fallback={<Skeleton className="h-[32rem] w-full max-w-sm rounded-xl" />}
      >
        <SignupPanel searchParams={searchParams} />
      </Suspense>

      <p className="text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

async function SignupPanel({
  searchParams,
}: {
  searchParams: PageProps<"/signup">["searchParams"];
}) {
  const params = await searchParams;
  const error = readParam(params.error);

  return (
    <SignInCard
      // Signing up is only the first step: onboarding collects the company
      // details and starts the Stripe subscription.
      mode="signup"
      next="/onboarding"
      title="Start your workspace"
      description="Create an account with your email, then name your company and pick a plan."
      error={error}
    />
  );
}
