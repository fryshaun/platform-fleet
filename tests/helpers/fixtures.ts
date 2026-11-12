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

/** A renter in the fixture workspace, for the bookings section's tests. */
export const CUSTOMER_ID = "44444444-4444-4444-8444-444444444444";

export function customerRow(
  overrides: Partial<Tables<"customers">> = {},
): Tables<"customers"> {
  return {
    id: CUSTOMER_ID,
    company_id: COMPANY_ID,
    profile_id: null,
    handle: "nadia-okafor",
    full_name: "Nadia Okafor",
    email: "nadia@example.com",
    phone: "+1 555 0100",
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A reservation in the fixture workspace, for the bookings section's tests. */
export const BOOKING_ID = "55555555-5555-4555-8555-555555555555";
export const LINE_ITEM_ID = "66666666-6666-4666-8666-666666666666";

export function bookingRow(
  overrides: Partial<Tables<"bookings">> = {},
): Tables<"bookings"> {
  return {
    id: BOOKING_ID,
    company_id: COMPANY_ID,
    reference: "BK-7F3K2Q",
    customer_id: CUSTOMER_ID,
    status: "pending",
    channel: "staff",
    starts_on: "2026-03-04",
    ends_on: "2026-03-08",
    currency: "usd",
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function lineItemRow(
  overrides: Partial<Tables<"booking_line_items">> = {},
): Tables<"booking_line_items"> {
  return {
    id: LINE_ITEM_ID,
    company_id: COMPANY_ID,
    booking_id: BOOKING_ID,
    product_id: PRODUCT_ID,
    asset_id: null,
    rider_id: null,
    quantity: 1,
    unit_price_cents: 4500,
    starts_on: "2026-03-04",
    ends_on: "2026-03-08",
    blocks_stock: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** An extra in the fixture workspace, for the extras tests. */
export const ADDON_ID = "77777777-7777-4777-8777-777777777777";

export function addonRow(
  overrides: Partial<Tables<"addons">> = {},
): Tables<"addons"> {
  return {
    id: ADDON_ID,
    company_id: COMPANY_ID,
    name: "Helmet",
    handle: "helmet",
    description: null,
    price_cents: 500,
    price_kind: "per_booking",
    max_quantity: 1,
    track_stock: false,
    quantity_on_hand: 0,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** One extra taken by a line. The price is the snapshot, not the catalogue's. */
export function lineAddonRow(
  overrides: Partial<Tables<"booking_line_addons">> = {},
): Tables<"booking_line_addons"> {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    company_id: COMPANY_ID,
    line_item_id: LINE_ITEM_ID,
    addon_id: ADDON_ID,
    quantity: 1,
    unit_price_cents: 500,
    price_kind: "per_booking",
    created_at: "2026-01-01T00:00:00.000Z",
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
