import { beforeEach, describe, expect, it, vi } from "vitest";

import { stripePrice, stripeRecurring } from "../helpers/stripe";

const stripeMock = vi.hoisted(() => ({ pricesList: vi.fn() }));

// `lib/subscriptions.ts` marks its page-facing reader with `cacheLife`; there is
// no cache component graph under test, so the directive is stubbed out.
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ prices: { list: stripeMock.pricesList } }),
}));

const { fetchSubscriptionPlans, findSubscriptionPlan, listSubscriptionPlans } =
  await import("@/lib/subscriptions");

/** Shapes a `prices.list` response the way the SDK would. */
function priceList(...prices: ReturnType<typeof stripePrice>[]) {
  return { data: prices };
}

describe("fetchSubscriptionPlans", () => {
  beforeEach(() => {
    stripeMock.pricesList.mockReset();
    // The allowlist is optional; an empty value means "every active price".
    vi.stubEnv("STRIPE_PLAN_PRICE_IDS", "");
  });

  it("asks Stripe for active recurring prices with their products", async () => {
    stripeMock.pricesList.mockResolvedValue(priceList(stripePrice()));

    await fetchSubscriptionPlans();

    expect(stripeMock.pricesList).toHaveBeenCalledWith({
      active: true,
      type: "recurring",
      limit: 100,
      expand: ["data.product"],
    });
  });

  it("returns the catalogue in pricing-table order", async () => {
    stripeMock.pricesList.mockResolvedValue(
      priceList(
        stripePrice({
          id: "price_annual",
          recurring: stripeRecurring({ interval: "year" }),
        }),
        stripePrice({ id: "price_monthly" }),
      ),
    );

    const plans = await fetchSubscriptionPlans();

    expect(plans.map((plan) => plan.priceId)).toEqual([
      "price_monthly",
      "price_annual",
    ]);
  });

  it("drops prices the subscription checkout cannot bill", async () => {
    stripeMock.pricesList.mockResolvedValue(
      priceList(
        stripePrice({ id: "price_metered", recurring: stripeRecurring({ usage_type: "metered" }) }),
        stripePrice({ id: "price_tiered", billing_scheme: "tiered" }),
        stripePrice({ id: "price_one_off", type: "one_time", recurring: null }),
        stripePrice({ id: "price_no_amount", unit_amount: null }),
        stripePrice({ id: "price_sellable" }),
      ),
    );

    const plans = await fetchSubscriptionPlans();

    expect(plans.map((plan) => plan.priceId)).toEqual(["price_sellable"]);
  });

  it("returns an empty catalogue when Stripe has no usable price", async () => {
    stripeMock.pricesList.mockResolvedValue(priceList());

    await expect(fetchSubscriptionPlans()).resolves.toEqual([]);
  });

  it("keeps only the prices in the configured allowlist", async () => {
    vi.stubEnv("STRIPE_PLAN_PRICE_IDS", " price_keep , price_other ");
    stripeMock.pricesList.mockResolvedValue(
      priceList(
        stripePrice({ id: "price_keep" }),
        stripePrice({ id: "price_retired" }),
        stripePrice({ id: "price_other" }),
      ),
    );

    const plans = await fetchSubscriptionPlans();

    expect(plans.map((plan) => plan.priceId)).toEqual([
      "price_keep",
      "price_other",
    ]);
  });

  it("treats a blank allowlist as no restriction", async () => {
    vi.stubEnv("STRIPE_PLAN_PRICE_IDS", "   ");
    stripeMock.pricesList.mockResolvedValue(
      priceList(stripePrice({ id: "price_a" }), stripePrice({ id: "price_b" })),
    );

    const plans = await fetchSubscriptionPlans();

    expect(plans).toHaveLength(2);
  });

  it("propagates a Stripe failure so the caller can explain it", async () => {
    stripeMock.pricesList.mockRejectedValue(new Error("Stripe is down"));

    await expect(fetchSubscriptionPlans()).rejects.toThrow("Stripe is down");
  });

describe("findSubscriptionPlan", () => {
  beforeEach(() => {
    stripeMock.pricesList.mockReset();
    vi.stubEnv("STRIPE_PLAN_PRICE_IDS", "");
  });

  it("resolves a submitted price id to the plan behind it", async () => {
    stripeMock.pricesList.mockResolvedValue(
      priceList(stripePrice({ id: "price_basic", unit_amount: 1900 })),
    );

    const plan = await findSubscriptionPlan("price_basic");

    expect(plan).toMatchObject({ priceId: "price_basic", unitAmount: 1900 });
  });

  it("returns null for a price that is no longer in the catalogue", async () => {
    stripeMock.pricesList.mockResolvedValue(priceList(stripePrice()));

    await expect(findSubscriptionPlan("price_archived")).resolves.toBeNull();
  });

  it("does not call Stripe when nothing was submitted", async () => {
    await expect(findSubscriptionPlan("")).resolves.toBeNull();

    expect(stripeMock.pricesList).not.toHaveBeenCalled();
  });

  it("reads the catalogue live, so a just-archived price cannot be bought", async () => {
    // A cached catalogue would let a price that Stripe has already archived
    // through, which is the one place staleness costs money.
    stripeMock.pricesList.mockResolvedValue(priceList(stripePrice()));

    await findSubscriptionPlan("price_pro_monthly");
    await findSubscriptionPlan("price_pro_monthly");

    expect(stripeMock.pricesList).toHaveBeenCalledTimes(2);
  });
});

describe("listSubscriptionPlans", () => {
  beforeEach(() => {
    stripeMock.pricesList.mockReset();
    vi.stubEnv("STRIPE_PLAN_PRICE_IDS", "");
  });

  it("returns the same catalogue the page renders", async () => {
    stripeMock.pricesList.mockResolvedValue(priceList(stripePrice()));

    const plans = await listSubscriptionPlans();

    expect(plans.map((plan) => plan.priceId)).toEqual(["price_pro_monthly"]);
  });
});

});
