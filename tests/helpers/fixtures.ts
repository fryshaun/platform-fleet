import type { SubscriptionPlan } from "@/lib/plans";
import type { Tables } from "@/lib/supabase/types";

/**
 * Row-shaped fixtures.
 *
 * Ids are opaque strings; nothing asserts uuid format, and plain strings keep
 * failures readable.
 */
export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

export function companyRow(
  overrides: Partial<Tables<"companies">> = {},
): Tables<"companies"> {
  return {
    id: COMPANY_ID,
    name: "Acme Studio",
    slug: "acme",
    stripe_customer_id: "cus_test_123",
    stripe_subscription_id: null,
    subscription_status: "none",
    trial_ends_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The price id the checkout tests treat as the plan the customer picked. */
export const PLAN_PRICE_ID = "price_pro_monthly";

/**
 * A plan as the catalogue hands it to the checkout actions.
 *
 * Actions resolve a submitted price id through `findSubscriptionPlan`, so tests
 * mock that module and hand back this shape instead of building Stripe prices.
 */
export function planFixture(
  overrides: Partial<SubscriptionPlan> = {},
): SubscriptionPlan {
  return {
    priceId: PLAN_PRICE_ID,
    productId: "prod_pro",
    name: "Pro",
    description: "For growing studios",
    nickname: "Pro monthly",
    unitAmount: 4900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    trialDays: null,
    ...overrides,
  };
}

/** Builds a `FormData` from a plain object, skipping `undefined` values. */
export function formDataOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}
