"use client";

import { BuildingIcon, LogOutIcon, UserCogIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { UserSettingsSheet } from "@/components/tenant/user-settings-sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/account";
import { signOut } from "@/lib/actions/auth";
import type { MfaFactor } from "@/lib/mfa";

type UserMenuProps = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** Whether the account has a password to confirm, or only an OAuth provider. */
  hasPassword: boolean;
  /** The authenticators and backup codes on the account. */
  mfa: { enrolled: boolean; factors: MfaFactor[] };
  workspaceName: string;
  roleLabel: string;
};

export function UserMenu({
  name,
  email,
  avatarUrl,
  hasPassword,
  mfa,
  workspaceName,
  roleLabel,
}: UserMenuProps) {
  const displayName = name ?? email.split("@")[0] ?? "Account";

  // The sheet is a sibling of the menu, not an item inside it: menu content
  // unmounts on close, and a dialog that unmounts as it opens never opens.
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account menu"
          >
            <Avatar>
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback>{initials(displayName)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="right" align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium">
              {displayName}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {email}
            </span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <UserCogIcon aria-hidden="true" />
            User settings
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {workspaceName} · {roleLabel}
          </DropdownMenuLabel>

          <DropdownMenuItem asChild>
            <Link href="/workspaces">
              <BuildingIcon aria-hidden="true" />
              Switch workspace
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <form action={signOut}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full cursor-pointer">
                <LogOutIcon aria-hidden="true" />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        email={email}
        fullName={name}
        avatarUrl={avatarUrl}
        hasPassword={hasPassword}
        mfa={mfa}
      />
    </>
  );
}
