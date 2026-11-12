import { Badge } from "@/components/ui/badge";
import { serviceStatusLabel } from "@/lib/servicing";
import type { ServiceStatus } from "@/lib/supabase/types";

/**
 * The service pill.
 *
 * "Overdue" is the one state that asks for a decision now, so it is the loud one;
 * "Due soon" is a warning rather than an alarm and stays an outline. The label
 * comes from `lib/servicing.ts` so the badge, the list and the summary cannot
 * disagree about what a status is called.
 */
export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  return (
    <Badge variant={status === "overdue" ? "destructive" : "outline"}>
      {serviceStatusLabel(status)}
    </Badge>
  );
}
