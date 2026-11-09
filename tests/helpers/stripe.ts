import type Stripe from "stripe";

/**
 * Stripe-shaped fixtures.
 *
 * A real `Stripe.Price` has dozens of fields, almost none of which the app
 * reads. Each factory therefore builds a plain object carrying only what the
 * code under test touches, and lets a test override anything else. The casts
 * are the price of that trade-off and stay confined to this file.
 */

export const PLAN_PRODUCT_ID = "prod_pro";

export function stripeProduct(
  overrides: Record<string, unknown> = {},
): Stripe.Product {
  const product = {
    id: PLAN_PRODUCT_ID,
    object: "product",
    active: true,
    name: "Pro",
    description: "For growing studios",
    ...overrides,
  };

  return product as unknown as Stripe.Product;
}

export function stripeRecurring(overrides: Record<string, unknown> = {}) {
  return {
    interval: "month",
    interval_count: 1,
    trial_period_days: null,
    usage_type: "licensed",
    ...overrides,
  };
}

/** A billable monthly price with its product expanded, as `prices.list` returns. */
export function stripePrice(
  overrides: Record<string, unknown> = {},
): Stripe.Price {
  const price = {
    id: "price_pro_monthly",
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    currency: "usd",
    nickname: "Pro monthly",
    product: stripeProduct(),
    recurring: stripeRecurring(),
    type: "recurring",
    unit_amount: 4900,
    ...overrides,
  };

  return price as unknown as Stripe.Price;
}

/** An `active` subscription belonging to `cus_test_123`. */
export function stripeSubscription(
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  const subscription = {
    id: "sub_test_123",
    object: "subscription",
    customer: "cus_test_123",
    status: "active",
    trial_end: null,
    metadata: {},
    items: { object: "list", data: [], has_more: false, url: "" },
    ...overrides,
  };

  return subscription as unknown as Stripe.Subscription;
}
