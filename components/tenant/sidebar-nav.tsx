"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxesIcon,
  CalendarCheckIcon,
  LayoutDashboardIcon,
  PackageIcon,
  TagsIcon,
  WrenchIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The icons the rail can draw. Callers name one instead of importing it. */
const NAV_ICONS = {
  dashboard: LayoutDashboardIcon,
  products: PackageIcon,
  assets: BoxesIcon,
  bookings: CalendarCheckIcon,
  categories: TagsIcon,
  kinds: WrenchIcon,
} as const;

export type NavIcon = keyof typeof NAV_ICONS;

/**
 * One entry in the rail.
 *
 * Plain data on purpose: the sidebar is a Server Component, and a component —
 * an icon included — cannot be handed to this Client Component as a prop. A
 * name can.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
};

/**
 * Primary navigation for a tenant.
 *
 * The caller decides which entries a workspace gets — the sections from
 * `lib/features.ts`, plus the screens that hang off one — and this component
 * only renders them and works out which entry is current. The current entry is
 * the *longest* href that matches the path, so `/t/products/categories` lights
 * Categories without lighting Products as well.
 *
 * Settings and billing are deliberately absent: both are admin-only and visited
 * rarely, so they live in the account menu instead of holding a permanent slot
 * here.
 */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  const activeHref = items
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .reduce<string | undefined>(
      (longest, item) =>
        longest === undefined || item.href.length > longest.length
          ? item.href
          : longest,
      undefined,
    );

  return (
    <TooltipProvider delayDuration={300}>
      <nav aria-label="Workspace" className="flex flex-col items-center gap-1">
        {items.map((item) => {
          const isActive = item.href === activeHref;
          const Icon = NAV_ICONS[item.icon];

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-9 items-center justify-center rounded-md transition-colors",
                    // The current section is the one place lime appears in the
                    // rail: a solid lime tile with a forest glyph.
                    isActive &&
                      "bg-brand-lime text-brand-forest hover:bg-brand-lime hover:text-brand-forest",
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

