import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";
import { cn } from "@/lib/utils";

/**
 * The banner a read-only workspace sees above its content.
 *
 * A Server Component with no state: the page decides whether the subscription
 * allows writing (`isWorkspaceWritable`) and renders this when it does not. The
 * sentence is the same one a refused Server Action returns, so the explanation
 * does not change shape between the page and the redirect back to it.
 *
 * Deliberately not a redirect and not a modal. Reads keep working, so taking the
 * catalogue away to sell a subscription would be a worse page than the one that
 * explains itself and still shows the catalogue.
 *
 * The billing link is only for people who can act on it: Settings → Billing is
 * owner and admin territory, and a staff member should not be sent to a door
 * that answers "You do not have permission to do that."
 */
export function ReadOnlyNotice({
  slug,
  canManageBilling,
  className,
}: {
  slug: string;
  /** True for owner and admin — the people who can fix the card. */
  canManageBilling: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("border-amber-600/30 bg-amber-500/5", className)}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
        <div className="space-y-1">
          <p className="text-sm font-medium">This workspace is read-only</p>
          <p className="text-muted-foreground text-xs">
            Nothing was deleted — reads keep working. {READ_ONLY_MESSAGE}
          </p>
        </div>
        {canManageBilling ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/${slug}/settings/billing`}>Go to billing</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
