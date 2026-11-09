import { Badge } from "@/components/ui/badge";
import {
  formatPlanPrice,
  planCadenceLabel,
  planTrialLabel,
  type SubscriptionPlan,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * Pick-one list of the plans Stripe returned.
 *
 * A plain radio group styled with `peer-checked:` utilities rather than local
 * state: the form posts a `plan` price id, the browser draws the selection, and
 * nothing runs on the client. That also means the picker can be rendered from a
 * Server Component page and from the client onboarding form alike.
 */
export function PlanPicker({
  plans,
  defaultPriceId,
  name = "plan",
  disabled = false,
  className,
}: {
  plans: SubscriptionPlan[];
  /** Pre-selects a plan; defaults to the first one returned. */
  defaultPriceId?: string | null;
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-3", className)} disabled={disabled}>
      <legend className="mb-2 text-sm leading-none font-medium">Plan</legend>

      {plans.map((plan) => {
        const trial = planTrialLabel(plan);

        return (
          <label key={plan.priceId} className="block cursor-pointer">
            <input
              type="radio"
              name={name}
              value={plan.priceId}
              defaultChecked={
                defaultPriceId
                  ? plan.priceId === defaultPriceId
                  : plan.priceId === plans[0]?.priceId
              }
              required
              className="peer sr-only"
            />
            <span className="border-input hover:bg-accent/40 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-ring flex items-start justify-between gap-4 rounded-lg border p-4 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
              <span className="min-w-0 space-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {plan.name}
                  {trial ? <Badge variant="secondary">{trial}</Badge> : null}
                </span>
                {plan.description ? (
                  <span className="text-muted-foreground block text-xs leading-relaxed">
                    {plan.description}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold">
                  {formatPlanPrice(plan)}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {planCadenceLabel(plan)}
                </span>
              </span>
            </span>
          </label>
        );
      })}

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No plans are available right now. Please try again later.
        </p>
      ) : null}
    </fieldset>
  );
}
