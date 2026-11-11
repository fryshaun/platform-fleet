"use client";

import { Loader2Icon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { TotpEnrollment } from "@/components/mfa/totp-enrollment";
import { Button } from "@/components/ui/button";
import {
  generateRecoveryCodes,
  regenerateRecoveryCodes,
  removeRecoveryCodes,
  removeTotpFactor,
  type MfaFormState,
} from "@/lib/actions/mfa";
import { hasRecoveryCodes, verifiedTotpFactors, type MfaFactor } from "@/lib/mfa";

const INITIAL_STATE: MfaFormState = {
  error: null,
  notice: null,
  enrollment: null,
  codes: null,
};

/**
 * The two-factor card in the account sheet.
 *
 * Two halves that belong together: the authenticator (the thing that proves who
 * you are at sign-in) and the backup codes (the thing that gets you back in when
 * the authenticator is gone). Codes never exist without an authenticator —
 * Supabase refuses to create the only factor as a set of codes — so the second
 * half only appears once the first is done.
 */
export function TwoFactorSection({
  mfa,
}: {
  mfa: { enrolled: boolean; factors: MfaFactor[] };
}) {
  const authenticator = verifiedTotpFactors(mfa.factors)[0];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Two-factor authentication</h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          A code from an authenticator app, on top of your password. Your
          workspaces may require it; you can turn it on here either way.
        </p>
      </div>

      {authenticator ? (
        <>
          <AuthenticatorCard factor={authenticator} />
          <BackupCodesCard hasCodes={hasRecoveryCodes(mfa.factors)} />
        </>
      ) : (
        <TotpEnrollment />
      )}
    </section>
  );
}

function AuthenticatorCard({ factor }: { factor: MfaFactor }) {
  const [state, formAction, isPending] = useActionState(
    removeTotpFactor,
    INITIAL_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheckIcon aria-hidden="true" className="size-4" />
            {factor.friendlyName ?? "Authenticator app"}
          </p>
          <p className="text-muted-foreground text-xs">
            Asks for a code every time you sign in.
          </p>
        </div>

        {confirming ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        )}
      </div>

      {confirming ? (
        <form action={formAction} className="mt-3 space-y-3">
          <input type="hidden" name="factor_id" value={factor.id} />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Removing this signs out your other devices and deletes any backup
            codes with it. You will sign in with just your password again.
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={isPending}
            >
              {isPending ? "Removing…" : "Remove it"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-3">
        <FormMessage
          error={state.error ?? undefined}
          success={state.notice ?? undefined}
        />
      </div>
    </div>
  );
}

/**
 * Backup codes: generate once, save them, use each one once.
 *
 * Three forms in one card, because the three things a person can do here are
 * mutually exclusive states of the same list: create it, replace it, delete it.
 * Whatever comes back from the server is shown **once** — GoTrue keeps hashes,
 * so a list that is not saved becomes a reason to regenerate.
 */
function BackupCodesCard({ hasCodes }: { hasCodes: boolean }) {
  const [generated, generateAction, isGenerating] = useActionState(
    generateRecoveryCodes,
    INITIAL_STATE,
  );
  const [regenerated, regenerateAction, isRegenerating] = useActionState(
    regenerateRecoveryCodes,
    INITIAL_STATE,
  );
  const [removed, removeAction, isRemoving] = useActionState(
    removeRecoveryCodes,
    INITIAL_STATE,
  );

  // Codes survive the revalidation that follows generating them, because this
  // component instance does — and are hidden on request, since they are the one
  // thing on this screen worth looking away from.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const codes = generated.codes ?? regenerated.codes;
  const visible = codes && codes !== dismissed ? codes : null;

  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <KeyRoundIcon aria-hidden="true" className="size-4" />
          Backup codes
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {hasCodes
            ? "One-time codes that sign you in when the app is gone. Save a fresh set if these ran out or went missing."
            : "A list of one-time codes to print or save, for the day your phone is lost, wiped or replaced."}
        </p>
      </div>

      {visible ? (
        <div className="mt-3 space-y-3">
          <ul className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {visible.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            Shown once. Each code works once.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(visible.join("\n"))
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy all"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(visible)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {hasCodes ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <form action={regenerateAction}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <Loader2Icon aria-hidden="true" className="animate-spin" />
                    Replacing…
                  </>
                ) : (
                  "Create a new set"
                )}
              </Button>
            </form>

            {confirmingRemove ? (
              <form action={removeAction} className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={isRemoving}
                >
                  {isRemoving ? "Removing…" : "Remove them"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Keep them
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingRemove(true)}
              >
                Remove
              </Button>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            A new set replaces the old one immediately: codes you saved earlier
            stop working.
          </p>
        </div>
      ) : (
        <form action={generateAction} className="mt-3">
          <Button type="submit" size="sm" disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2Icon aria-hidden="true" className="animate-spin" />
                Generating…
              </>
            ) : (
              "Generate backup codes"
            )}
          </Button>
        </form>
      )}

      <div className="mt-3">
        <FormMessage
          error={
            generated.error ?? regenerated.error ?? removed.error ?? undefined
          }
          success={removed.notice ?? undefined}
        />
      </div>
    </div>
  );
}

