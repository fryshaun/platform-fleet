import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TotpEnrollment } from "@/components/mfa/totp-enrollment";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/lib/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { readParam } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Set up two-factor authentication",
};

/**
 * The enrolment screen a workspace can force (`companies.require_mfa`).
 *
 * Reachable by choice too — a person with no authenticator may want one — but
 * its reason for existing is the redirect from `enforceMfa`, which sends an aal1
 * session here when the workspace it is trying to open demands a second factor.
 *
 * The escape hatch matters: somebody who cannot install an app should be able to
 * sign out rather than be trapped in a page they cannot complete. Removing the
 * requirement is the owner's job, and the card says so.
 */
export default function MfaSetupPage({
  searchParams,
}: PageProps<"/mfa/setup">) {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Platform
      </Link>

      <Suspense
        fallback={<Skeleton className="h-80 w-full max-w-md rounded-xl" />}
      >
        <SetupPanel searchParams={searchParams} />
      </Suspense>

      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}

async function SetupPanel({
  searchParams,
}: {
  searchParams: PageProps<"/mfa/setup">["searchParams"];
}) {
  const query = await searchParams;
  const next = safeNextPath(readParam(query.next));

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Already set up: the confirmation on this page would refuse anyway, and the
  // page the person was aiming at is one factor away.
  if (user.mfa.enrolled) {
    redirect(next);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Add a second factor</CardTitle>
        <CardDescription>
          This workspace asks everyone to sign in with an authenticator app. Scan
          the code below to turn it on for your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TotpEnrollment next={next} />

        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
          Locked out of your app? Ask an owner or admin of this workspace to turn
          the requirement off, or use your backup codes if you saved them.
        </p>
      </CardContent>
    </Card>
  );
}
