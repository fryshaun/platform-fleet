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
    enabled_sections: [],
    currency: "usd",
    logo_url: null,
    badge: null,
    require_mfa: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The price id the checkout tests treat as the plan the customer picked. */
export const PLAN_PRICE_ID = "price_pro_monthly";

/** A product in the fixture workspace, for the section's tests. */
export const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

export function productRow(
  overrides: Partial<Tables<"products">> = {},
): Tables<"products"> {
  return {
    id: PRODUCT_ID,
    company_id: COMPANY_ID,
    parent_id: null,
    category_id: null,
    title: "Espresso beans",
    handle: "espresso-beans",
    description: null,
    status: "active",
    kind: "item",
    sku: null,
    supplier: null,
    price_cents: 1800,
    currency: "usd",
    compare_at_price_cents: null,
    track_inventory: true,
    inventory_quantity: 12,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A unit in the fixture workspace, for the assets section's tests. */
export const ASSET_ID = "33333333-3333-4333-8333-333333333333";

export function assetRow(
  overrides: Partial<Tables<"assets">> = {},
): Tables<"assets"> {
  return {
    id: ASSET_ID,
    company_id: COMPANY_ID,
    product_id: null,
    name: "bike-1",
    handle: "bike-1",
    serial: null,
    status: "available",
    status_changed_at: "2026-01-01T00:00:00.000Z",
    notes: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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
