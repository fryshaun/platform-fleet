"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { AuthError, AuthNotice } from "@/components/auth/auth-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type AuthFormState } from "@/lib/actions/auth";

const INITIAL_STATE: AuthFormState = { error: null, notice: null };

/**
 * "Forgot your password?", folded under the sign-in form.
 *
 * Closed until asked for, like the magic-link form, so the card keeps one job at
 * a time: the sign-in card already carries a password form, a Google button and
 * a passwordless link.
 */
export function ForgotPasswordForm() {
  const [isOpen, setIsOpen] = useState(false);

  const [state, formAction, isSending] = useActionState(
    requestPasswordReset,
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
        Forgot your password?
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {state.error ? <AuthError>{state.error}</AuthError> : null}
      {state.notice ? <AuthNotice>{state.notice}</AuthNotice> : null}

      <form action={formAction} className="space-y-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
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
          ) : (
            "Email me a reset link"
          )}
        </Button>
      </form>

      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => setIsOpen(false)}
      >
        Back to sign in
      </Button>
    </div>
  );
}
