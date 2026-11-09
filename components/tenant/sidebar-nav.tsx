"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxesIcon,
  LayoutDashboardIcon,
  PackageIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SECTIONS, type SectionKey } from "@/lib/features";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
};

/** One icon per section; the labels and paths come from `lib/features.ts`. */
const SECTION_ICONS: Record<SectionKey, typeof LayoutDashboardIcon> = {
  products: PackageIcon,
  assets: BoxesIcon,
};

/**
 * Primary navigation for a tenant.
 *
 * Each section is a folder under `app/[tenant]/`: add it to `SECTION_KEYS` and it
 * appears in the rail with the active state already wired up — the caller
 * decides *which* sections a workspace gets, this component only renders them.
 * Settings and billing are deliberately absent: both are admin-only and visited
 * rarely, so they live in the account menu instead of holding a permanent slot
 * here.
 */
export function SidebarNav({
  tenantSlug,
  sections,
}: {
  tenantSlug: string;
  sections: readonly SectionKey[];
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      href: `/${tenantSlug}/dashboard`,
      label: "Dashboard",
      icon: LayoutDashboardIcon,
    },
    ...sections.map((key) => ({
      href: `/${tenantSlug}/${SECTIONS[key].path}`,
      label: SECTIONS[key].label,
      icon: SECTION_ICONS[key],
    })),
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
