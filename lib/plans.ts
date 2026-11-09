import type Stripe from "stripe";

/**
 * A subscription option a company can be checked out against.
 *
 * Prices live in Stripe, so the catalogue is read from the API rather than
 * configured per deployment. The shape here is deliberately plain and
 * serialisable: it crosses the server/client boundary as props, so every field
 * the picker renders is already resolved on the server.
 *
 * Kept free of `server-only`, `next/cache` and Stripe client imports so that a
 * Client Component can import the formatting helpers without pulling the SDK
 * into the browser bundle.
 */
export type SubscriptionPlan = {
  priceId: string;
  productId: string | null;
  name: string;
  description: string | null;
  nickname: string | null;
  /** Amount in the currency's minor unit, exactly as Stripe reports it. */
  unitAmount: number;
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
  /** Days of free trial Stripe is configured to grant for this price. */
  trialDays: number | null;
};

export type PlanInterval = "day" | "week" | "month" | "year";

const PLAN_INTERVALS: readonly PlanInterval[] = ["day", "week", "month", "year"];

/**
 * Converts a Stripe Price into a plan, or `null` when checkout cannot use it.
 *
 * `prices.list` already filters on `active` and `type=recurring`, but the
 * conversion repeats the checks because the same function runs over expanded
 * products and over prices fetched individually. Anything the subscription
 * checkout cannot bill at a fixed quantity — metered, tiered, one-off, free
 * with no amount — is dropped rather than rendered as a broken option.
 */
export function toSubscriptionPlan(price: Stripe.Price): SubscriptionPlan | null {
  const recurring = price.recurring;

  if (price.type !== "recurring" || !recurring) return null;
  if (!price.active) return null;
  if (price.billing_scheme !== "per_unit") return null;
  if (recurring.usage_type !== "licensed") return null;
  if (typeof price.unit_amount !== "number") return null;

  const interval = toPlanInterval(recurring.interval);
  if (!interval) return null;

  const product = expandedProduct(price.product);

  return {
    priceId: price.id,
    productId: product?.id ?? (typeof price.product === "string" ? price.product : null),
    name: product?.name ?? price.nickname ?? "Subscription",
    description: product?.description ?? null,
    nickname: price.nickname ?? null,
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval,
    intervalCount: recurring.interval_count,
    trialDays: recurring.trial_period_days ?? null,
  };
}

/** Orders plans the way a pricing table reads: shortest cadence, cheapest first. */
export function sortPlans(plans: SubscriptionPlan[]): SubscriptionPlan[] {
  return [...plans].sort(
    (a, b) =>
      PLAN_INTERVALS.indexOf(a.interval) - PLAN_INTERVALS.indexOf(b.interval) ||
      a.intervalCount - b.intervalCount ||
      a.unitAmount - b.unitAmount ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Formats an amount for display.
 *
 * Matches the `price_cents` convention used across the app: amounts are in the
 * currency's minor unit and are shown divided by 100.
 */
export function formatPlanPrice(plan: Pick<SubscriptionPlan, "unitAmount" | "currency">): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: plan.currency.toUpperCase(),
  }).format(plan.unitAmount / 100);
}

/** "per month", "every 3 months", "per year". */
export function planCadenceLabel(
  plan: Pick<SubscriptionPlan, "interval" | "intervalCount">,
): string {
  const unit = plan.interval;
  return plan.intervalCount === 1
    ? `per ${unit}`
    : `every ${plan.intervalCount} ${unit}s`;
}

/** "14-day free trial", or `null` when the price grants no trial. */
export function planTrialLabel(
  plan: Pick<SubscriptionPlan, "trialDays">,
): string | null {
  if (!plan.trialDays) return null;
  return plan.trialDays === 1
    ? "1-day free trial"
    : `${plan.trialDays}-day free trial`;
}

/**
 * Renders a Stripe price as a one-line amount, e.g. `$49 per month`.
 *
 * Used for the price on the company's *current* subscription, which arrives
 * nested in the subscription rather than from the plan catalogue. Returns
 * `null` for a price with no fixed amount (metered or free).
 */
export function formatStripePrice(
  price: Pick<Stripe.Price, "unit_amount" | "currency" | "recurring">,
): string | null {
  if (typeof price.unit_amount !== "number") return null;

  const amount = formatPlanPrice({
    unitAmount: price.unit_amount,
    currency: price.currency,
  });

  const interval = price.recurring
    ? toPlanInterval(price.recurring.interval)
    : null;

  if (!price.recurring || !interval) return amount;

  return `${amount} ${planCadenceLabel({
    interval,
    intervalCount: price.recurring.interval_count,
  })}`;
}

/**
 * The expanded product behind a price, or `null` when the price carries only an
 * id (an unexpanded list) or the product has been deleted or archived.
 *
 * `product` is nullable: Stripe returns `null` for a price whose product was
 * deleted, which is exactly the case a catalogue read has to survive.
 */
function expandedProduct(product: Stripe.Price["product"]): Stripe.Product | null {
  if (!product || typeof product === "string") return null;
  // A deleted product arrives expanded as a `DeletedProduct`, which has no
  // `active` flag; requiring one keeps archived products out of the catalogue.
  if (!("active" in product)) return null;

  return product.active ? product : null;
}

function toPlanInterval(interval: string): PlanInterval | null {
  return PLAN_INTERVALS.includes(interval as PlanInterval)
    ? (interval as PlanInterval)
    : null;
}
