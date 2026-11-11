import { companyMark } from "@/lib/company";
import { cn } from "@/lib/utils";

/**
 * The square that stands for a workspace.
 *
 * Three sources, in the order the settings screen offers them: an uploaded logo,
 * a badge of one or two characters, and — failing both — the initials of the
 * name. It is one component rather than three copies because the rail, the
 * workspace chooser and the settings preview must never disagree about which of
 * the three wins.
 *
 * Deliberately directive-free: the rail and the chooser render it on the server,
 * and the uploader renders it inside a client component to preview a file before
 * the page refreshes. Nothing here needs either environment.
 *
 * A plain `<img>` rather than `next/image`: the URL is a public Storage object on
 * a host this app does not optimise for.
 */
export function CompanyMark({
  name,
  logoUrl,
  badge,
  className,
}: {
  name: string;
  logoUrl: string | null;
  badge: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-md",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- public Storage URL, not an optimizable local asset
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : (
        // A badge is usually a glyph rather than text, so it gets the larger size;
        // two letters need the letterspacing of the smaller one to breathe.
        <span
          className={
            badge ? "text-base leading-none" : "text-xs font-semibold"
          }
        >
          {companyMark(name, badge)}
        </span>
      )}
    </span>
  );
}
