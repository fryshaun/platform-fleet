"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyRecoveryCode, type MfaFormState } from "@/lib/actions/mfa";
import { MFA_PATH } from "@/lib/mfa";

const INITIAL_STATE: MfaFormState = {
  error: null,
  notice: null,
  enrollment: null,
  codes: null,
};

/**
 * The backup-code half of `/mfa`.
 *
 * The field is a plain text input: codes are letters and digits, the server
 * ignores case and dashes, and `inputMode`/`autocomplete` hints only get in the
 * way of a paste. Whether the code is real is GoTrue's answer, not a regex here.
 */
export function RecoveryCodeChallenge({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(
    verifyRecoveryCode,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      {state.error ? <FormMessage error={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="recovery-code">Backup code</Label>
        <Input
          id="recovery-code"
          name="code"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="k4m9-x7qp-2ab8"
          required
          className="font-mono"
        />
        <p className="text-muted-foreground text-xs">
          Each code works once. Capitals and dashes do not matter.
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            Checking…
          </>
        ) : (
          "Continue"
        )}
      </Button>

      <p className="text-center text-sm">
        <Link href={MFA_PATH} className="text-muted-foreground underline">
          Use the authenticator app instead
        </Link>
      </p>
    </form>
  );
}
