"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";

import { AuthError, AuthNotice } from "@/components/auth/auth-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import {
  signInWithEmail,
  signUpWithEmail,
  type AuthFormState,
} from "@/lib/actions/auth";

const INITIAL_STATE: AuthFormState = { error: null, notice: null };

export type AuthMode = "signin" | "signup";

type EmailPasswordFormProps = {
  mode: AuthMode;
  /** Where to send the user after a successful sign in. */
  next: string;
};

/**
 * The email + password half of the sign-in card.
 *
 * Sign in and sign up share one component because the fields are identical; the
 * mode only changes the copy, the password manager hint, and which action runs.
 */
export function EmailPasswordForm({ mode, next }: EmailPasswordFormProps) {
  const [state, formAction, isPending] = useActionState(
    mode === "signup" ? signUpWithEmail : signInWithEmail,
    INITIAL_STATE,
  );

  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      {state.error ? <AuthError>{state.error}</AuthError> : null}
      {state.notice ? <AuthNotice>{state.notice}</AuthNotice> : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
          aria-describedby={isSignup ? "password-hint" : undefined}
          required
        />
        {isSignup ? (
          <p id="password-hint" className="text-muted-foreground text-xs">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={isPending}
      >
        {isPending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            {isSignup ? "Creating account…" : "Signing in…"}
          </>
        ) : isSignup ? (
          "Create account"
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
