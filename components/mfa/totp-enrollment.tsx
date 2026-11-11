"use client";

import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmTotpEnrollment,
  startTotpEnrollment,
  type MfaFormState,
} from "@/lib/actions/mfa";
import { TOTP_CODE_LENGTH, qrCodeDataUrl } from "@/lib/mfa";

const INITIAL_STATE: MfaFormState = {
  error: null,
  notice: null,
  enrollment: null,
  codes: null,
};

/**
 * Turning an authenticator app on: the QR code, the key behind it, and the code
 * that proves the two sides agree.
 *
 * Two steps rather than one because enrolling *creates* a factor on the server.
 * Doing that while rendering a page would create a new one on every prefetch, so
 * the first button is an explicit act and the state it returns holds the secret.
 *
 * The same component serves both entrances. `/mfa/setup` passes `next`, which the
 * confirmation uses to redirect back to the page that sent the person there; the
 * account sheet passes nothing and stays open, because a redirect would navigate
 * the page behind the sheet.
 */
export function TotpEnrollment({ next }: { next?: string }) {
  const [startState, startAction, isStarting] = useActionState(
    startTotpEnrollment,
    INITIAL_STATE,
  );

  const enrollment = startState.enrollment;

  if (!enrollment) {
    return (
      <form action={startAction} className="space-y-3">
        <FormMessage error={startState.error ?? undefined} />

        <Button type="submit" size="sm" disabled={isStarting}>
          {isStarting ? (
            <>
              <Loader2Icon aria-hidden="true" className="animate-spin" />
              Preparing…
            </>
          ) : (
            "Set up an authenticator app"
          )}
        </Button>

        <p className="text-muted-foreground text-xs">
          You will need a code generator such as 1Password, Google Authenticator
          or Authy.
        </p>
      </form>
    );
  }

  return <ConfirmForm enrollment={enrollment} next={next} />;
}

function ConfirmForm({
  enrollment,
  next,
}: {
  enrollment: { factorId: string; secret: string; svg: string };
  next?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    confirmTotpEnrollment,
    INITIAL_STATE,
  );

  // Hidden until asked for: the key is long, and it is on screen only while
  // somebody is typing it into their phone.
  const [revealed, setRevealed] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <input type="hidden" name="factor_id" value={enrollment.factorId} />

      <div className="flex flex-wrap items-start gap-4">
        {/* Printed on a white square: a scanner needs the quiet zone, and the
            code is black on transparent. */}
        <img
          src={qrCodeDataUrl(enrollment.svg)}
          alt="QR code to scan with your authenticator app"
          width={176}
          height={176}
          className="size-44 shrink-0 rounded-md border bg-white p-2"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">
            Scan the code, or type the key into your app.
          </p>

          <Label htmlFor="totp-secret">Setup key</Label>
          <div className="flex gap-2">
            <Input
              id="totp-secret"
              value={enrollment.secret}
              readOnly
              type={revealed ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRevealed((shown) => !shown)}
            >
              {revealed ? "Hide" : "Show"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            The key is a secret. It is shown here once and is never written to a
            log.
          </p>
        </div>
      </div>

      <div className="max-w-40 space-y-2">
        <Label htmlFor="totp-code">Code from the app</Label>
        <Input
          id="totp-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={TOTP_CODE_LENGTH + 1}
          required
          className="font-mono tracking-widest"
        />
      </div>

      <FormMessage
        error={state.error ?? undefined}
        success={state.notice ?? undefined}
      />

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            Checking…
          </>
        ) : (
          <>
            <ShieldCheckIcon aria-hidden="true" />
            Turn on two-factor authentication
          </>
        )}
      </Button>

      <p className="text-muted-foreground text-xs">
        Confirming signs out your other devices — you will need the app the next
        time you sign in on them.
      </p>
    </form>
  );
}
