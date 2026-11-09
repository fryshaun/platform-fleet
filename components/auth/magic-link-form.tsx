"use client";

import { useActionState, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { AuthError, AuthNotice } from "@/components/auth/auth-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OTP_LENGTH } from "@/lib/auth-policy";
import {
  sendMagicLink,
  verifyEmailOtp,
  type AuthFormState,
} from "@/lib/actions/auth";

const INITIAL_STATE: AuthFormState = { error: null, notice: null };

type MagicLinkFormProps = {
  /** Where to send the user after a successful sign in. */
  next: string;
};

/**
 * Passwordless sign in: a link, plus the one-time code that arrives with it.
 *
 * The code form exists because a link is often opened on a different device
 * than the one signing in — the phone's mail app, for instance — and the PKCE
 * cookie needed to finish a link only exists in the browser that asked for it.
 */
export function MagicLinkForm({ next }: MagicLinkFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");

  const [linkState, sendLink, isSending] = useActionState(
    sendMagicLink,
    INITIAL_STATE,
  );
  const [codeState, submitCode, isVerifying] = useActionState(
    verifyEmailOtp,
    INITIAL_STATE,
  );

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => setIsOpen(true)}
      >
        Email me a sign-in link instead
      </Button>
    );
  }

  const linkSent = linkState.notice !== null;

  return (
    <div className="space-y-4">
      {linkState.error ? <AuthError>{linkState.error}</AuthError> : null}
      {linkState.notice ? <AuthNotice>{linkState.notice}</AuthNotice> : null}

      <form action={sendLink} className="space-y-2">
        <input type="hidden" name="next" value={next} />
        <Label htmlFor="magic-link-email">Email</Label>
        <Input
          id="magic-link-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="w-full"
          disabled={isSending}
        >
          {isSending ? (
            <>
              <Loader2Icon aria-hidden="true" className="animate-spin" />
              Sending…
            </>
          ) : linkSent ? (
            "Send another link"
          ) : (
            "Email me a link"
          )}
        </Button>
      </form>

      {linkSent ? (
        <form action={submitCode} className="space-y-2">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email} />
          {codeState.error ? <AuthError>{codeState.error}</AuthError> : null}
          <div className="space-y-2">
            <Label htmlFor="magic-link-code">Code from the email</Label>
            <Input
              id="magic-link-code"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`\\d{${OTP_LENGTH}}`}
              maxLength={OTP_LENGTH}
              placeholder={"0".repeat(OTP_LENGTH)}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isVerifying}
          >
            {isVerifying ? (
              <>
                <Loader2Icon aria-hidden="true" className="animate-spin" />
                Verifying…
              </>
            ) : (
              "Verify code"
            )}
          </Button>
        </form>
      ) : null}

      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => setIsOpen(false)}
      >
        Use a password instead
      </Button>
    </div>
  );
}
