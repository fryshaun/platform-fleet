import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { isRecoveryWindowOpen } from "@/lib/recovery";

export const metadata: Metadata = {
  title: "Choose a new password",
};

/**
 * The page a recovery link lands on, after `/auth/callback` verified it.
 *
 * Deliberately not in `proxy.ts`'s protected routes: the link works in a browser
 * that has never signed in, and the only thing that grants the page its form is
 * the recovery cookie the callback wrote. Without a session *and* that cookie
 * there is nothing to reset, so the card explains the link instead of bouncing
 * the visitor to a sign-in they did not ask for.
 */
export default function ResetPasswordPage() {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Platform
      </Link>

      <Suspense
        fallback={<Skeleton className="h-80 w-full max-w-sm rounded-xl" />}
      >
        <ResetPasswordPanel />
      </Suspense>

      <p className="text-muted-foreground text-sm">
        Remembered it?{" "}
        <Link href="/login" className="text-foreground font-medium underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

async function ResetPasswordPanel() {
  const user = await getCurrentUser();
  const mayReset = user !== null && (await isRecoveryWindowOpen());

  if (!user || !mayReset) {
    return <LinkExpiredCard />;
  }

  return <ResetPasswordForm email={user.email} />;
}

function LinkExpiredCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">This link has expired</CardTitle>
        <CardDescription>
          Password reset links work once and expire within an hour. Ask for a
          fresh one from the sign-in page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
