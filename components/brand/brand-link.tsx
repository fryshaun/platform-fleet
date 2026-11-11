import Link from "next/link";

import { cn } from "@/lib/utils";

import { TrackstandLogo } from "./logo";

type BrandLinkProps = {
  className?: string;
  /** Text size class for the lockup, e.g. `text-xl`. */
  logoClassName?: string;
};

/**
 * The lockup as a link home. Every standalone page (landing, auth, error) uses
 * this so the brand mark always returns the reader to `/`.
 */
function BrandLink({ className, logoClassName }: BrandLinkProps) {
  return (
    <Link
      href="/"
      aria-label="Trackstand home"
      className={cn(
        "focus-visible:ring-ring/50 inline-flex rounded-sm outline-none focus-visible:ring-[3px]",
        className,
      )}
    >
      <TrackstandLogo className={logoClassName} />
    </Link>
  );
}

export { BrandLink };
