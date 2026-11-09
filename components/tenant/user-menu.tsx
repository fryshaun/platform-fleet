"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingIcon,
  CreditCardIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";

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
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

type UserMenuProps = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** Tenant slug — the workspace settings and billing links are scoped to it. */
  tenantSlug: string;
  workspaceName: string;
  roleLabel: string;
  /** Settings and billing are owner/admin-only, so managers never see them. */
  canAdminister: boolean;
};

export function UserMenu({
  name,
  email,
  avatarUrl,
  tenantSlug,
  workspaceName,
  roleLabel,
  canAdminister,
}: UserMenuProps) {
  const displayName = name ?? email.split("@")[0] ?? "Account";
  const pathname = usePathname();

  // Settings and billing sit here rather than in the rail: they are rare
  // administrative tasks, while the rail is reserved for daily work.
  const workspaceLinks = canAdminister
    ? [
        {
          href: `/${tenantSlug}/settings`,
          label: "Settings",
          icon: SettingsIcon,
        },
        {
          href: `/${tenantSlug}/settings/billing`,
          label: "Billing",
          icon: CreditCardIcon,
        },
      ]
    : [];

  return (
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

        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {workspaceName} · {roleLabel}
        </DropdownMenuLabel>

        {workspaceLinks.length > 0
          ? workspaceLinks.map(({ href, label, icon: Icon }) => {
              const isCurrent = pathname === href;

              return (
                <DropdownMenuItem key={href} asChild>
                  <Link
                    href={href}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(
                      isCurrent && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </Link>
                </DropdownMenuItem>
              );
            })
          : null}

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
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
