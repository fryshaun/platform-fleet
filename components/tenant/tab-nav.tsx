import Link from "next/link";

import { cn } from "@/lib/utils";

/** One tab: where it goes and what it is called. */
export type TabItem = {
  href: string;
  label: string;
};

/**
 * A row of links that reads as a tab strip.
 *
 * The tabs are URLs rather than local state. Every screen behind them is
 * server-rendered, so switching has to be a navigation anyway — and a URL can be
 * shared, bookmarked and restored by the back button, which a `useState` tab
 * cannot. `aria-current` carries the selection for assistive technology; the
 * underline is only decoration.
 */
export function TabNav({
  items,
  current,
  label,
}: {
  items: readonly TabItem[];
  /** The href of the open tab. */
  current: string;
  /** Accessible name for the strip, e.g. "Settings". */
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {items.map((item) => {
        const isCurrent = item.href === current;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              isCurrent
                ? "border-foreground text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
