"use client";

import { SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { settingsPath } from "@/lib/settings";
import { cn } from "@/lib/utils";

/**
 * The gear beside the avatar.
 *
 * It replaces the "Settings" entry the account menu used to carry: workspace
 * settings are a place you go, not something you do to your account, and one
 * permanent icon beats two clicks through a menu. The caller draws it for owner
 * and admin only — every settings screen 404s for anybody else — so there is no
 * locked state to explain here.
 *
 * The link points at the index tab (Company) and stays lit for any `/settings`
 * path, so the gear does not go dark while the Team or Billing tab is open.
 */
export function SettingsLink({ slug }: { slug: string }) {
  const pathname = usePathname();
  const href = settingsPath(slug, "company");
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label="Settings"
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-9 items-center justify-center rounded-md transition-colors",
              isActive && "bg-accent text-foreground",
            )}
          >
            <SettingsIcon aria-hidden="true" className="size-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
