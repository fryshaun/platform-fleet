"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboardIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
};

/**
 * Primary navigation for a tenant.
 *
 * Each section is a folder under `app/[tenant]/`: add it to `items` and it
 * appears in the rail with the active state already wired up. Settings and
 * billing are deliberately absent: both are admin-only and visited rarely, so
 * they live in the account menu instead of holding a permanent slot here.
 */
export function SidebarNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      href: `/${tenantSlug}/dashboard`,
      label: "Dashboard",
      icon: LayoutDashboardIcon,
    },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <nav aria-label="Workspace" className="flex flex-col items-center gap-1">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-9 items-center justify-center rounded-md transition-colors",
                    isActive && "bg-accent text-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
