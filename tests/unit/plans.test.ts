import { describe, expect, it } from "vitest";

import {
  formatPlanPrice,
  formatStripePrice,
  planCadenceLabel,
  planTrialLabel,
  sortPlans,
  toSubscriptionPlan,
  type SubscriptionPlan,
} from "@/lib/plans";

import { stripePrice, stripeProduct, stripeRecurring } from "../helpers/stripe";

/** A plan carrying only the fields a sorting or formatting test cares about. */
function plan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    priceId: "price_plan",
    productId: null,
    name: "Plan",
    description: null,
    nickname: null,
    unitAmount: 1000,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    trialDays: null,
    ...overrides,
  };
}

describe("toSubscriptionPlan", () => {
  it("converts a billable recurring price into a plan", () => {
    expect(toSubscriptionPlan(stripePrice())).toEqual({
      priceId: "price_pro_monthly",
      productId: "prod_pro",
      name: "Pro",
      description: "For growing studios",
      nickname: "Pro monthly",
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      trialDays: null,
    });
  });

  it("carries the trial Stripe is configured to grant", () => {
    const converted = toSubscriptionPlan(
      stripePrice({ recurring: stripeRecurring({ trial_period_days: 14 }) }),
    );

    expect(converted?.trialDays).toBe(14);
  });

  it("keeps a quarterly cadence intact", () => {
    const converted = toSubscriptionPlan(
      stripePrice({ recurring: stripeRecurring({ interval_count: 3 }) }),
    );

    expect(converted).toMatchObject({ interval: "month", intervalCount: 3 });
  });

  it("falls back to the price nickname when the product is only an id", () => {
    const converted = toSubscriptionPlan(stripePrice({ product: "prod_lazy" }));

    expect(converted).toMatchObject({
      productId: "prod_lazy",
      name: "Pro monthly",
      description: null,
    });
  });

  it("ignores an archived product, since it cannot be sold", () => {
    const converted = toSubscriptionPlan(
      stripePrice({ product: stripeProduct({ active: false }) }),
    );

    expect(converted).toMatchObject({ productId: null, name: "Pro monthly" });
  });
  it("ignores a deleted product, which arrives without an active flag", () => {
    // Stripe expands a deleted product as `{ id, deleted: true }`, so reading
    // `.active` off it would throw inside the catalogue loader.
    const converted = toSubscriptionPlan(
      stripePrice({
        product: { id: "prod_gone", object: "product", deleted: true },
      }),
    );

    expect(converted).toMatchObject({ productId: null, name: "Pro monthly" });
  });



  it("falls back to a generic name when there is no product or nickname", () => {
    const converted = toSubscriptionPlan(
      stripePrice({ product: null, nickname: null }),
    );

    expect(converted?.name).toBe("Subscription");
  });

  it.each([
    ["a one-off price", { type: "one_time", recurring: null }],
    ["an archived price", { active: false }],
    ["a tiered price", { billing_scheme: "tiered" }],
    [
      "a metered price",
      { recurring: stripeRecurring({ usage_type: "metered" }) },
    ],
    ["a price with no fixed amount", { unit_amount: null }],
    ["a recurring price missing its schedule", { recurring: null }],
    [
      "an interval the checkout cannot label",
      { recurring: stripeRecurring({ interval: "fortnight" }) },
    ],
  ])("drops %s", (_label, overrides) => {
    expect(toSubscriptionPlan(stripePrice(overrides))).toBeNull();
  });

  it("keeps a free price, which checkout can still bill", () => {
    // Only a *missing* amount is unbillable; zero is a real price.
    expect(toSubscriptionPlan(stripePrice({ unit_amount: 0 }))?.unitAmount).toBe(
      0,
    );
  });
});


describe("sortPlans", () => {
  const weekly = plan({
    priceId: "price_weekly",
    name: "Weekly",
    interval: "week",
    unitAmount: 1200,
  });
  const pro = plan({
    priceId: "price_pro",
    name: "Pro",
    interval: "month",
    unitAmount: 4900,
  });
  const team = plan({
    priceId: "price_team",
    name: "Team",
    interval: "month",
    unitAmount: 4900,
  });
  const quarterly = plan({
    priceId: "price_quarterly",
    name: "Quarterly",
    interval: "month",
    intervalCount: 3,
    unitAmount: 10000,
  });
  const annual = plan({
    priceId: "price_annual",
    name: "Annual",
    interval: "year",
    unitAmount: 100000,
  });

  it("orders by cadence, then interval count, amount and name", () => {
    const sorted = sortPlans([annual, team, quarterly, pro, weekly]);

    expect(sorted.map((entry) => entry.priceId)).toEqual([
      "price_weekly",
      "price_pro",
      "price_team",
      "price_quarterly",
      "price_annual",
    ]);
  });

  it("leaves the array it was given alone", () => {
    const input = [annual, weekly];

    sortPlans(input);

    expect(input.map((entry) => entry.priceId)).toEqual([
      "price_annual",
      "price_weekly",
    ]);
  });

  it("is stable for a single plan", () => {
    expect(sortPlans([pro])).toEqual([pro]);
  });
});

describe("formatPlanPrice", () => {
  it("renders minor units as currency", () => {
    expect(formatPlanPrice({ unitAmount: 4900, currency: "usd" })).toBe(
      "$49.00",
    );
  });

  it("accepts a lowercase currency code", () => {
    expect(formatPlanPrice({ unitAmount: 1250, currency: "gbp" })).toBe(
      "£12.50",
    );
  });

  it("renders a free plan", () => {
    expect(formatPlanPrice({ unitAmount: 0, currency: "usd" })).toBe("$0.00");
  });
});

describe("planCadenceLabel", () => {
  it("describes a single interval", () => {
    expect(planCadenceLabel({ interval: "month", intervalCount: 1 })).toBe(
      "per month",
    );
  });

  it("describes a repeated interval", () => {
    expect(planCadenceLabel({ interval: "month", intervalCount: 3 })).toBe(
      "every 3 months",
    );
    expect(planCadenceLabel({ interval: "day", intervalCount: 2 })).toBe(
      "every 2 days",
    );
  });

  it("describes a yearly plan", () => {
    expect(planCadenceLabel({ interval: "year", intervalCount: 1 })).toBe(
      "per year",
    );
  });
});


describe("planTrialLabel", () => {
  it("is null when the plan grants no trial", () => {
    expect(planTrialLabel({ trialDays: null })).toBeNull();
    expect(planTrialLabel({ trialDays: 0 })).toBeNull();
  });

  it("spells out the length of the trial", () => {
    expect(planTrialLabel({ trialDays: 14 })).toBe("14-day free trial");
  });

  it("stays grammatical for a single day", () => {
    expect(planTrialLabel({ trialDays: 1 })).toBe("1-day free trial");
  });
});

describe("formatStripePrice", () => {
  it("renders the amount and cadence of a recurring price", () => {
    expect(formatStripePrice(stripePrice())).toBe("$49.00 per month");
  });

  it("renders a yearly price", () => {
    expect(
      formatStripePrice(
        stripePrice({
          unit_amount: 49000,
          recurring: stripeRecurring({ interval: "year" }),
        }),
      ),
    ).toBe("$490.00 per year");
  });

  it("renders a multi-interval price", () => {
    expect(
      formatStripePrice(
        stripePrice({
          unit_amount: 12900,
          recurring: stripeRecurring({ interval_count: 3 }),
        }),
      ),
    ).toBe("$129.00 every 3 months");
  });

  it("returns null when the price has no fixed amount", () => {
    expect(formatStripePrice(stripePrice({ unit_amount: null }))).toBeNull();
  });

  it("returns a bare amount for a price with no cadence", () => {
    expect(
      formatStripePrice(stripePrice({ recurring: null, type: "one_time" })),
    ).toBe("$49.00");
  });
});
