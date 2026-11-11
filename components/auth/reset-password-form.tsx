"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";

import { AuthError } from "@/components/auth/auth-message";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  setRecoveredPassword,
  type AccountFormState,
} from "@/lib/actions/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

const INITIAL_STATE: AccountFormState = { error: null, notice: null };

type ResetPasswordFormProps = {
  /** The address being recovered, shown so nobody resets the wrong account. */
  email: string;
};

/**
 * The one form on `/reset-password`.
 *
 * There is no "current password" field on purpose: the session was established
 * by the recovery link, which is the proof this form runs on.
 */
export function ResetPasswordForm({ email }: ResetPasswordFormProps) {
  const [state, formAction, isPending] = useActionState(
    setRecoveredPassword,
    INITIAL_STATE,
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>
          {email
            ? `Setting the password for ${email}.`
            : "Setting a new password for your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.error ? <AuthError>{state.error}</AuthError> : null}

          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="reset-password-hint"
              required
            />
            <p id="reset-password-hint" className="text-muted-foreground text-xs">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation">Confirm new password</Label>
            <Input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
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
                Saving…
              </>
            ) : (
              "Save password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
