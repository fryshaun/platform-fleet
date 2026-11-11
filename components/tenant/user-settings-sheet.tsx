"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormMessage } from "@/components/form-message";
import { AvatarUploader } from "@/components/tenant/avatar-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FULL_NAME_MAX, initials } from "@/lib/account";
import {
  changePassword,
  updateProfile,
  type AccountFormState,
} from "@/lib/actions/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

const EMPTY_STATE: AccountFormState = { error: null, notice: null };

/**
 * The account sheet: photo, name and password.
 *
 * A sheet rather than a route because everything in it is one person's own
 * business, reached from the avatar — not a place with a URL to share, and not a
 * page worth losing your place on a dashboard to visit.
 *
 * `open` is owned by `UserMenu`, which also owns the dropdown. Radix needs the
 * sheet to be a *sibling* of the menu rather than a child of its content: menu
 * content unmounts when it closes, and a dialog that unmounts as it opens never
 * opens at all.
 *
 * Both forms use `useActionState` because their actions answer instead of
 * redirecting — a redirect would navigate the page under the sheet and close it.
 */
export function UserSettingsSheet({
  open,
  onOpenChange,
  email,
  fullName,
  avatarUrl,
  hasPassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** False for an account that only signs in through an OAuth provider. */
  hasPassword: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Your account</SheetTitle>
          <SheetDescription>
            Your photo, your name and your password. They follow you into every
            workspace.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Photo</h3>
            <AvatarUploader
              initialUrl={avatarUrl}
              initials={initials(fullName ?? email)}
            />
          </section>

          <ProfileForm fullName={fullName} email={email} />
          <PasswordForm hasPassword={hasPassword} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileForm({
  fullName,
  email,
}: {
  fullName: string | null;
  email: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateProfile,
    EMPTY_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Name</h3>
        <p className="text-muted-foreground text-xs">
          Shown in the team list and next to your work. Leave it empty to use
          your email address instead.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="account-name">Full name</Label>
        <Input
          id="account-name"
          name="full_name"
          defaultValue={fullName ?? ""}
          placeholder="Ada Lovelace"
          autoComplete="name"
          maxLength={FULL_NAME_MAX}
        />
      </div>

      <FormMessage
        error={state.error ?? undefined}
        success={state.notice ?? undefined}
      />

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Save name"}
      </Button>

      <p className="text-muted-foreground border-t pt-3 text-xs leading-relaxed">
        Signed in as {email}. The address itself belongs to your sign-in method
        and is changed there.
      </p>
    </form>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, formAction, isPending] = useActionState(
    changePassword,
    EMPTY_STATE,
  );

  // A saved password should not stay in the fields while the sheet is open.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.notice) {
      formRef.current?.reset();
    }
  }, [state.notice]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {hasPassword ? "Password" : "Set a password"}
        </h3>
        <p className="text-muted-foreground text-xs">
          {hasPassword
            ? "You are asked for the current one first, so a borrowed browser cannot lock you out."
            : "You sign in with Google. Setting a password also lets you sign in with your email address."}
        </p>
      </div>

      {hasPassword ? (
        <div className="space-y-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm</Label>
          <Input
            id="confirm-password"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={200}
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        At least {MIN_PASSWORD_LENGTH} characters.
      </p>

      <FormMessage
        error={state.error ?? undefined}
        success={state.notice ?? undefined}
      />

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </Button>
    </form>
  );
}

