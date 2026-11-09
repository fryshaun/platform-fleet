import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignInCard } from "@/components/auth/sign-in-card";
import { Skeleton } from "@/components/ui/skeleton";
import { readParam } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Platform
      </Link>

      <Suspense
        fallback={
          <Skeleton className="h-[32rem] w-full max-w-sm rounded-xl" />
        }
      >
        <LoginPanel searchParams={searchParams} />
      </Suspense>

      <p className="text-muted-foreground text-sm">
        No account yet?{" "}
        <Link href="/signup" className="text-foreground font-medium underline">
          Create a company
        </Link>
      </p>
    </main>
  );
}

async function LoginPanel({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const params = await searchParams;
  const error = readParam(params.error);
  const next = readParam(params.next) ?? "/workspaces";

  return (
    <SignInCard
      mode="signin"
      next={next}
      title="Welcome back"
      description="Sign in with your email, a one-time code, or Google."
      error={error}
    />
  );
}
