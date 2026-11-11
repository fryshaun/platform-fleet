import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BrandLink } from "@/components/brand/brand-link";
import { RecoveryCodeChallenge } from "@/components/mfa/recovery-code-challenge";
import { TotpChallenge } from "@/components/mfa/totp-challenge";
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
import { hasRecoveryCodes, verifiedTotpFactors } from "@/lib/mfa";
import { readAssuranceLevel } from "@/lib/mfa-server";
import { safeNextPath } from "@/lib/safe-redirect";
import { readParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Two-factor authentication",
};

/**
 * Where a session proves its second factor.
 *
 * Deliberately outside `/[tenant]`: a factor belongs to the account, not to a
 * workspace, and the page must render for somebody whose session is at aal1 —
 * which is exactly the session every tenant layout turns away. The data access
 * layer sends people here rather than failing them (see `enforceMfa`), so this
 * page is the gate and cannot itself be gated.
 *
 * `?mode=backup` swaps the form for the backup-code one; two forms on one route
 * beats a route that only differs by which input it renders, and it keeps the
 * `next` value in one place.
 */
export default function MfaPage({ searchParams }: PageProps<"/mfa">) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <BrandLink logoClassName="text-xl" />

      <Suspense
        fallback={<Skeleton className="h-80 w-full max-w-sm rounded-xl" />}
      >
        <MfaPanel searchParams={searchParams} />
      </Suspense>

      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}

async function MfaPanel({
  searchParams,
}: {
  searchParams: PageProps<"/mfa">["searchParams"];
}) {
  const query = await searchParams;
  const next = safeNextPath(readParam(query.next));

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const factors = verifiedTotpFactors(user.mfa.factors);

  // Nothing to ask for: no authenticator means no challenge, and a session that
  // is already at aal2 has answered it. Both are "carry on", not an error — a
  // stale bookmark or a second tab lands here all the time.
  if (factors.length === 0) {
    redirect(next);
  }

  const { currentLevel } = await readAssuranceLevel(await createClient());
  if (currentLevel === "aal2") {
    redirect(next);
  }

  // `?mode=backup` is only honoured when there are codes to use: a link followed
  // after the codes were replaced would otherwise land on a form that cannot
  // succeed.
  const hasCodes = hasRecoveryCodes(user.mfa.factors);
  const wantsBackupCode = hasCodes && readParam(query.mode) === "backup";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">One more step</CardTitle>
        <CardDescription>
          {wantsBackupCode
            ? "Enter one of the backup codes you saved when you set up two-factor authentication."
            : "Enter the code from your authenticator app to finish signing in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {wantsBackupCode ? (
          <RecoveryCodeChallenge next={next} />
        ) : (
          <TotpChallenge
            factors={factors}
            next={next}
            hasBackupCodes={hasCodes}
          />
        )}
      </CardContent>
    </Card>
  );
}
