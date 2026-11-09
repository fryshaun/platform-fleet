import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_ID, companyRow } from "../helpers/fixtures";
import { stripeSubscription } from "../helpers/stripe";
import { createSupabaseMock, type DbResult } from "../helpers/supabase";

const stripeMock = vi.hoisted(() => ({ subscriptionsList: vi.fn() }));
const adminMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { list: stripeMock.subscriptionsList } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: adminMock.createAdminClient,
}));

const {
  hasLiveSubscription,
  isSubscriptionActive,
  mapSubscriptionStatus,
  needsReconciliation,
  pickSubscription,
  reconcileCompanySubscription,
  syncSubscription,
  toSubscriptionPatch,
} = await import("@/lib/billing/sync");

/** Installs an admin mock whose `companies` queries resolve to `result`. */
function installAdmin(result: DbResult = { data: [{ id: COMPANY_ID }] }) {
  const mock = createSupabaseMock({ tables: { companies: () => result } });
  adminMock.createAdminClient.mockReturnValue(mock.client);
  return mock;
}

/** Silences the diagnostic logging the module does on recoverable failures. */
function silenceConsole() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("mapSubscriptionStatus", () => {
  it.each<[Stripe.Subscription.Status, string]>([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["incomplete", "incomplete"],
    ["incomplete_expired", "incomplete_expired"],
    ["unpaid", "unpaid"],
    ["paused", "paused"],
  ])("maps %s to %s", (stripeStatus, expected) => {
    expect(mapSubscriptionStatus(stripeStatus)).toBe(expected);
  });

  it("maps a status Stripe invents later to incomplete", () => {
    // The union is open-ended; an unknown value must not be stored as-is,
    // because `companies.subscription_status` is an enum.
    const future = "some_future_status" as Stripe.Subscription.Status;

    expect(mapSubscriptionStatus(future)).toBe("incomplete");
  });
});

describe("toSubscriptionPatch", () => {
  it("takes the columns the subscription owns", () => {
    expect(toSubscriptionPatch(stripeSubscription({ trial_end: 1800000000 })))
      .toEqual({
        stripe_subscription_id: "sub_test_123",
        subscription_status: "active",
        trial_ends_at: new Date(1800000000 * 1000).toISOString(),
      });
  });

  it("clears the trial column when there is no trial left", () => {
    expect(
      toSubscriptionPatch(stripeSubscription({ trial_end: null })),
    ).toMatchObject({ trial_ends_at: null });
  });
});

describe("isSubscriptionActive", () => {
  it("counts the two states that mean Stripe has the money", () => {
    expect(isSubscriptionActive("active")).toBe(true);
    expect(isSubscriptionActive("trialing")).toBe(true);
  });

  it.each(["none", "incomplete", "past_due", "unpaid", "canceled"] as const)(
    "does not count %s",
    (status) => {
      expect(isSubscriptionActive(status)).toBe(false);
    },
  );
});

describe("hasLiveSubscription", () => {
  it.each([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
  ] as const)(
    "reports %s, which Stripe can still revive without a new checkout",
    (status) => {
      expect(hasLiveSubscription(status)).toBe(true);
    },
  );

  it.each(["none", "canceled", "incomplete_expired"] as const)(
    "reports %s as needing a fresh checkout",
    (status) => {
      expect(hasLiveSubscription(status)).toBe(false);
    },
  );
});

describe("needsReconciliation", () => {
  const NOW = Date.parse("2026-06-01T00:00:00.000Z");

  it("never calls Stripe for a company with no customer", () => {
    expect(
      needsReconciliation(
        companyRow({ stripe_customer_id: null, subscription_status: "none" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("never calls Stripe for a settled subscription", () => {
    expect(
      needsReconciliation(
        companyRow({ subscription_status: "active", trial_ends_at: "2026-01-01T00:00:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("re-reads a trial that is still running only once it has run out", () => {
    const endsLater = companyRow({
      subscription_status: "trialing",
      trial_ends_at: "2026-06-02T00:00:00.000Z",
    });
    const ended = companyRow({
      subscription_status: "trialing",
      trial_ends_at: "2026-05-31T00:00:00.000Z",
    });

    expect(needsReconciliation(endsLater, NOW)).toBe(false);
    expect(needsReconciliation(ended, NOW)).toBe(true);
  });

  it("re-reads a trial with no end date, which cannot be trusted", () => {
    expect(
      needsReconciliation(
        companyRow({ subscription_status: "trialing", trial_ends_at: null }),
        NOW,
      ),
    ).toBe(true);
  });

  it("re-reads a trial that has already ended by exactly now", () => {
    expect(
      needsReconciliation(
        companyRow({
          subscription_status: "trialing",
          trial_ends_at: new Date(NOW).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it.each([
    "none",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
    "canceled",
    "incomplete_expired",
  ] as const)("re-reads the unsettled state %s", (status) => {
    expect(needsReconciliation(companyRow({ subscription_status: status }), NOW))
      .toBe(true);
  });
});

describe("pickSubscription", () => {
  const current = stripeSubscription({
    id: "sub_current",
    status: "active",
  });
  const cancelled = stripeSubscription({
    id: "sub_cancelled",
    status: "canceled",
  });
  const expired = stripeSubscription({
    id: "sub_expired",
    status: "incomplete_expired",
  });

  it("returns null when Stripe holds nothing for the customer", () => {
    expect(pickSubscription([], null)).toBeNull();
  });

  it("prefers the subscription the row already points at", () => {
    expect(pickSubscription([cancelled, current], "sub_current")).toBe(current);
  });

  it("passes over a finished subscription even when it is the stored one", () => {
    // A cancelled subscription stays in the customer's list forever, so the
    // stored id cannot win by default after a re-subscribe.
    expect(pickSubscription([cancelled, current], "sub_cancelled")).toBe(
      current,
    );
  });

  it("takes the first live subscription when nothing is stored", () => {
    expect(pickSubscription([cancelled, current, expired], null)).toBe(current);
  });

  it("falls back to the stored subscription when every one is finished", () => {
    expect(pickSubscription([expired, cancelled], "sub_cancelled")).toBe(
      cancelled,
    );
  });
});


describe("syncSubscription", () => {
  beforeEach(() => {
    adminMock.createAdminClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the subscription onto the company named in its metadata", async () => {
    const admin = installAdmin();

    const matched = await syncSubscription(
      stripeSubscription({ metadata: { company_id: COMPANY_ID } }),
    );

    expect(matched).toBe(COMPANY_ID);
    expect(admin.chainsFor("companies")).toEqual([
      [
        {
          method: "update",
          args: [
            {
              stripe_subscription_id: "sub_test_123",
              subscription_status: "active",
              trial_ends_at: null,
            },
          ],
        },
        { method: "eq", args: ["id", COMPANY_ID] },
        // Selecting the row back is what makes "matched nothing" detectable.
        { method: "select", args: ["id"] },
      ],
    ]);
  });

  it("falls back to the Stripe customer id when metadata is missing", async () => {
    const admin = installAdmin();

    const matched = await syncSubscription(
      stripeSubscription({ metadata: {}, customer: "cus_lookup" }),
    );

    expect(matched).toBe("cus_lookup");
    expect(admin.argsFor("companies", "eq")).toEqual([
      ["stripe_customer_id", "cus_lookup"],
    ]);
  });

  it("resolves an expanded customer object to its id", async () => {
    const admin = installAdmin();

    await syncSubscription(
      stripeSubscription({
        metadata: {},
        customer: { id: "cus_expanded" },
      }),
    );

    expect(admin.argsFor("companies", "eq")).toEqual([
      ["stripe_customer_id", "cus_expanded"],
    ]);
  });

  it("returns null and logs when no company matched", async () => {
    const consoleError = silenceConsole();
    installAdmin({ data: [] });

    const matched = await syncSubscription(
      stripeSubscription({ metadata: { company_id: COMPANY_ID } }),
    );

    expect(matched).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("matched no company"),
    );
  });

  it("names the customer in the log when there is no metadata to blame", async () => {
    const consoleError = silenceConsole();
    installAdmin({ data: [] });

    await syncSubscription(
      stripeSubscription({ metadata: {}, customer: "cus_orphan" }),
    );

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("customer=cus_orphan"),
    );
  });

  it("throws so the webhook answers 5xx and Stripe retries", async () => {
    installAdmin({ data: null, error: { message: "connection reset" } });

    await expect(syncSubscription(stripeSubscription())).rejects.toThrow(
      "Could not update company subscription: connection reset",
    );
  });
});


describe("reconcileCompanySubscription", () => {
  beforeEach(() => {
    stripeMock.subscriptionsList.mockReset();
    adminMock.createAdminClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing for a company that has no Stripe customer", async () => {
    const company = companyRow({ stripe_customer_id: null });

    const result = await reconcileCompanySubscription(company);

    expect(result).toEqual({ company, subscription: null, changed: false });
    expect(stripeMock.subscriptionsList).not.toHaveBeenCalled();
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("re-reads every subscription the customer has", async () => {
    stripeMock.subscriptionsList.mockResolvedValue({ data: [] });

    await reconcileCompanySubscription(companyRow());

    // Cancelled subscriptions stay in the list, so `status: "all"` is what
    // makes the newest live one visible.
    expect(stripeMock.subscriptionsList).toHaveBeenCalledWith({
      customer: "cus_test_123",
      status: "all",
      limit: 10,
    });
  });

  it("repairs a row the webhook never updated", async () => {
    const subscription = stripeSubscription({ id: "sub_live" });
    stripeMock.subscriptionsList.mockResolvedValue({ data: [subscription] });
    const admin = installAdmin();

    const result = await reconcileCompanySubscription(companyRow());

    expect(result.changed).toBe(true);
    expect(result.subscription).toBe(subscription);
    expect(result.company).toMatchObject({
      stripe_subscription_id: "sub_live",
      subscription_status: "active",
      trial_ends_at: null,
    });
    expect(admin.argsFor("companies", "update")).toEqual([
      [
        {
          stripe_subscription_id: "sub_live",
          subscription_status: "active",
          trial_ends_at: null,
        },
      ],
    ]);
    expect(admin.argsFor("companies", "eq")).toEqual([["id", COMPANY_ID]]);
  });

  it("writes nothing when the stored row already agrees", async () => {
    stripeMock.subscriptionsList.mockResolvedValue({
      data: [stripeSubscription({ id: "sub_test_123" })],
    });

    const result = await reconcileCompanySubscription(
      companyRow({
        stripe_subscription_id: "sub_test_123",
        subscription_status: "active",
      }),
    );

    expect(result.changed).toBe(false);
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("compares trial timestamps by instant, not by string format", async () => {
    // Postgres and `toISOString()` disagree on formatting, so a naive string
    // comparison would rewrite the row on every render.
    const trialEnd = 1800000000;
    const postgresStyle = new Date(trialEnd * 1000)
      .toISOString()
      .replace(".000Z", "+00:00");

    stripeMock.subscriptionsList.mockResolvedValue({
      data: [
        stripeSubscription({
          id: "sub_test_123",
          status: "trialing",
          trial_end: trialEnd,
        }),
      ],
    });

    const result = await reconcileCompanySubscription(
      companyRow({
        stripe_subscription_id: "sub_test_123",
        subscription_status: "trialing",
        trial_ends_at: postgresStyle,
      }),
    );

    expect(result.changed).toBe(false);
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("leaves the row alone when Stripe holds no subscription", async () => {
    stripeMock.subscriptionsList.mockResolvedValue({ data: [] });
    const company = companyRow();

    const result = await reconcileCompanySubscription(company);

    expect(result).toEqual({ company, subscription: null, changed: false });
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps the stored row when Stripe cannot be reached", async () => {
    const consoleError = silenceConsole();
    stripeMock.subscriptionsList.mockRejectedValue(new Error("socket hang up"));
    const company = companyRow();

    const result = await reconcileCompanySubscription(company);

    expect(result).toEqual({ company, subscription: null, changed: false });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`for company ${COMPANY_ID}`),
      "socket hang up",
    );
  });

  it("keeps the stored row when the repair write fails", async () => {
    const consoleError = silenceConsole();
    stripeMock.subscriptionsList.mockResolvedValue({
      data: [stripeSubscription({ id: "sub_live" })],
    });
    installAdmin({ data: null, error: { message: "permission denied" } });
    const company = companyRow();

    const result = await reconcileCompanySubscription(company);

    expect(result).toEqual({ company, subscription: null, changed: false });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`for company ${COMPANY_ID}`),
      "permission denied",
    );
  });
});

