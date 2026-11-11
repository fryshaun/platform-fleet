"use client";

import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyTotpCode, type MfaFormState } from "@/lib/actions/mfa";
import { MFA_PATH, TOTP_CODE_LENGTH, type MfaFactor } from "@/lib/mfa";

const INITIAL_STATE: MfaFormState = {
  error: null,
  notice: null,
  enrollment: null,
  codes: null,
};

/**
 * The `/mfa` form: the code from the authenticator app.
 *
 * `factors` is already narrowed to confirmed authenticators, and the app only
 * ever enrols one, so the first is the one to challenge — no picker to get wrong.
 * If a second ever appears (an admin API, another app), the first still works.
 */
export function TotpChallenge({
  factors,
  next,
  hasBackupCodes,
}: {
  factors: readonly MfaFactor[];
  next: string;
  /** Whether the account has codes to fall back to — no link if it does not. */
  hasBackupCodes: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    verifyTotpCode,
    INITIAL_STATE,
  );

  const factor = factors[0];
  const backupHref = `${MFA_PATH}?next=${encodeURIComponent(next)}&mode=backup`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {factor ? <input type="hidden" name="factor_id" value={factor.id} /> : null}

      {state.error ? <FormMessage error={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="mfa-code">Code from your authenticator app</Label>
        <Input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          maxLength={TOTP_CODE_LENGTH + 1}
          required
          className="font-mono tracking-widest"
        />
        <p className="text-muted-foreground text-xs">
          Six digits. The app shows a new one every 30 seconds.
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            Checking…
          </>
        ) : (
          <>
            <ShieldCheckIcon aria-hidden="true" />
            Continue
          </>
        )}
      </Button>

      <p className="text-center text-sm">
        {hasBackupCodes ? (
          <Link href={backupHref} className="text-muted-foreground underline">
            Use a backup code instead
          </Link>
        ) : (
          <span className="text-muted-foreground">
            No backup codes yet — you can create some once you are in, under User
            settings.
          </span>
        )}
      </p>
    </form>
  );
}
