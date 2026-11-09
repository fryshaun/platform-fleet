import "server-only";

import { cacheLife } from "next/cache";

import { sortPlans, toSubscriptionPlan, type SubscriptionPlan } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";

/**
 * The plan catalogue, read from Stripe.
 *
 * Prices (and the products they belong to) are the source of truth, so adding a
 * plan is a Dashboard change rather than a deploy: create an active recurring
 * price and it appears in the picker.
 */

/**
 * Reads every billable plan straight from Stripe.
 *
 * Uncached on purpose: Server Actions validate a submitted price id against
 * this, and a stale catalogue would let a price that was just archived through.
 */
export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const prices = await getStripe().prices.list({
    active: true,
    type: "recurring",
    limit: 100,
    expand: ["data.product"],
  });

  const allowlist = readPlanAllowlist();

  return sortPlans(
    prices.data
      .filter((price) => allowlist === null || allowlist.includes(price.id))
      .map(toSubscriptionPlan)
      .filter((plan): plan is SubscriptionPlan => plan !== null),
  );
}

/**
 * Request-scoped read of the catalogue for pages.
 *
 * `'use cache: private'` dedupes the call within a render and keeps the result
 * in the browser only. A plain `'use cache'` would run `prices.list` during
 * `next build`, where there are no Stripe keys, and break the build.
 */
export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  "use cache: private";
  cacheLife("minutes");

  return fetchSubscriptionPlans();
}

/**
 * Resolves a submitted price id to a plan.
 *
 * The single check behind both checkout flows: the client only ever sends a
 * price id, and anything not currently in the catalogue is refused.
 */
export async function findSubscriptionPlan(
  priceId: string,
): Promise<SubscriptionPlan | null> {
  if (!priceId) return null;

  const plans = await fetchSubscriptionPlans();
  return plans.find((plan) => plan.priceId === priceId) ?? null;
}

/**
 * An optional comma-separated allowlist of price ids (`STRIPE_PLAN_PRICE_IDS`).
 *
 * Accounts that keep old prices active — for grandfathered customers, say —
 * would otherwise show all of them. Unset means "every active recurring price".
 */
function readPlanAllowlist(): string[] | null {
  const raw = process.env.STRIPE_PLAN_PRICE_IDS?.trim();
  if (!raw) return null;

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return ids.length > 0 ? ids : null;
}
