import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Trackstand mark: three forward-leaning bars, like a rider holding a
 * trackstand. The geometry is traced from the supplied artwork
 * (`public/logos/trackstand-logo-*.jpg`) so the code lockup matches it
 * proportionally: outer bars 26 units wide, centre bar 21 (narrower, as drawn),
 * 20-unit gaps, and a 41° lean from vertical.
 *
 * Fills come from `--logo-bar-*`, which flip per theme: forest centre bar on
 * light, emerald on dark. See `app/globals.css`.
 */
const BARS = [
  { d: "M135 0H161L26 154H0Z", fill: "var(--logo-bar-outer)" },
  { d: "M181 0H202L67 154H46Z", fill: "var(--logo-bar-center)" },
  { d: "M222 0H248L113 154H87Z", fill: "var(--logo-bar-outer)" },
] as const;

type MarkProps = Omit<React.ComponentProps<"svg">, "viewBox"> & {
  /** Accessible name. Omit when the mark sits next to the wordmark. */
  title?: string;
};

/**
 * The bare mark. Sized in `em` (1.11× the current font size, the same ratio as
 * the artwork) so it scales with whatever the surrounding text is set to.
 */
function TrackstandMark({ className, title, ...props }: MarkProps) {
  return (
    <svg
      viewBox="0 0 248 154"
      className={cn("h-[1.11em] w-auto shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {BARS.map((bar) => (
        <path key={bar.d} d={bar.d} fill={bar.fill} />
      ))}
    </svg>
  );
}

type LogoProps = React.ComponentProps<"span"> & {
  markClassName?: string;
  wordmarkClassName?: string;
};

/**
 * The primary horizontal lockup: mark then wordmark, sentence case, set in
 * Plus Jakarta Sans Bold at −0.02em.
 *
 * Size the whole lockup from one text size — `<TrackstandLogo className="text-xl" />`
 * gives a ~22px mark and a 20px wordmark, the artwork's own proportions. Keep
 * clear space of at least the wordmark's lowercase height on all sides.
 */
function TrackstandLogo({
  className,
  markClassName,
  wordmarkClassName,
  ...props
}: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.2em] select-none",
        className,
      )}
      {...props}
    >
      <TrackstandMark className={markClassName} />
      <span
        className={cn(
          "font-display leading-none font-bold tracking-[-0.02em]",
          wordmarkClassName,
        )}
      >
        Trackstand
      </span>
    </span>
  );
}

type StackProps = React.ComponentProps<"div"> & {
  /** Asset reference printed under the wordmark, e.g. `TS-0142`. */
  assetId?: string;
  /** Slot for a QR code supplied by the caller. */
  qr?: React.ReactNode;
};

/**
 * The stacked asset lockup: mark over the wordmark, with an optional serial in
 * JetBrains Mono and a QR slot. Used on asset labels and printable tags.
 */
function TrackstandStack({
  className,
  assetId,
  qr,
  children,
  ...props
}: StackProps) {
  return (
    <div
      className={cn("inline-flex flex-col items-start gap-3", className)}
      {...props}
    >
      <TrackstandMark className="h-10" />
      <span className="font-display text-2xl leading-none font-bold tracking-[-0.02em]">
        Trackstand
      </span>
      {assetId ? (
        <span className="text-muted-foreground font-mono text-xs tracking-tight">
          {assetId}
        </span>
      ) : null}
      {qr}
      {children}
    </div>
  );
}

export { TrackstandLogo, TrackstandMark, TrackstandStack };
