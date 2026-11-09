import { beforeEach, describe, expect, it, vi } from "vitest";

import { companyRow, formDataOf, PLAN_PRICE_ID, planFixture, COMPANY_ID } from "../helpers/fixtures";
import { captureRedirect, redirectParams, redirectPath } from "../helpers/redirect";
import { tenantSetup } from "../helpers/tenant";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const stripeMock = vi.hoisted(() => ({
  portalCreate: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
}));
const plansMock = vi.hoisted(() => ({ findSubscriptionPlan: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("@/lib/site", () => ({
  getOrigin: async () => "https://platform.example.com",
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: stripeMock.portalCreate } },
    customers: { create: stripeMock.customersCreate },
    checkout: { sessions: { create: stripeMock.sessionsCreate } },
  }),
}));

vi.mock("@/lib/subscriptions", () => ({
  findSubscriptionPlan: plansMock.findSubscriptionPlan,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const { openBillingPortal, startSubscriptionCheckout } = await import(
  "@/lib/actions/billing"
);

describe("openBillingPortal", () => {
  beforeEach(() => {
    stripeMock.portalCreate.mockReset();
    stripeMock.portalCreate.mockResolvedValue({
      url: "https://billing.stripe.com/p/session",
    });
  });

  it("sends a request with no slug to the workspace picker", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "" })),
    );

    expect(url).toBe("/workspaces");
    expect(stripeMock.portalCreate).not.toHaveBeenCalled();
  });

  it("refuses a plain member", async () => {
    tenantSetup(serverMock.createClient, {}, "member");

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "acme" })),
    );

    expect(redirectPath(url)).toBe("/acme/settings/billing");
    expect(redirectParams(url).get("error")).toBe(
      "Only owners and admins can manage billing.",
    );
    expect(stripeMock.portalCreate).not.toHaveBeenCalled();
  });

  it("refuses a manager", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "acme" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Only owners and admins can manage billing.",
    );
    expect(stripeMock.portalCreate).not.toHaveBeenCalled();
  });

  it("explains that billing needs a Stripe customer first", async () => {
    tenantSetup(serverMock.createClient, {
      companies: () => ({
        data: companyRow({ stripe_customer_id: null }),
        error: null,
      }),
    });

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "acme" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "This company has no Stripe customer yet. Start a checkout first.",
    );
    expect(stripeMock.portalCreate).not.toHaveBeenCalled();
  });

  it("opens a portal session for the company's customer", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "acme" })),
    );

    expect(stripeMock.portalCreate).toHaveBeenCalledWith({
      customer: "cus_test_123",
      return_url: "https://platform.example.com/acme/settings/billing",
    });
    expect(url).toBe("https://billing.stripe.com/p/session");
  });

  it("lets an admin open the portal too", async () => {
    tenantSetup(serverMock.createClient, {}, "admin");

    const url = await captureRedirect(() =>
      openBillingPortal(formDataOf({ slug: "acme" })),
    );

    expect(url).toBe("https://billing.stripe.com/p/session");
  });
});

describe("startSubscriptionCheckout", () => {
  beforeEach(() => {
    stripeMock.customersCreate.mockReset();
    stripeMock.sessionsCreate.mockReset();
    plansMock.findSubscriptionPlan.mockReset();

    stripeMock.customersCreate.mockResolvedValue({ id: "cus_new" });
    stripeMock.sessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay_test",
    });
    plansMock.findSubscriptionPlan.mockResolvedValue(planFixture());
  });

  /** The form the billing page posts when the buyer picks a plan. */
  const checkoutForm = (overrides: Record<string, string> = {}) =>
    formDataOf({ slug: "acme", plan: PLAN_PRICE_ID, ...overrides });

  it("sends a request with no slug to the workspace picker", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(formDataOf({ slug: "", plan: PLAN_PRICE_ID })),
    );

    expect(url).toBe("/workspaces");
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses a plain member", async () => {
    tenantSetup(serverMock.createClient, {}, "member");

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Only owners and admins can manage billing.",
    );
    expect(plansMock.findSubscriptionPlan).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses a manager", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Only owners and admins can manage billing.",
    );
    expect(plansMock.findSubscriptionPlan).not.toHaveBeenCalled();
  });

  it.each([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
  ] as const)(
    "sends a workspace that is already %s to the portal instead",
    async (status) => {
      tenantSetup(serverMock.createClient, {
        companies: () => ({
          data: companyRow({ subscription_status: status }),
          error: null,
        }),
      });

      const url = await captureRedirect(() =>
        startSubscriptionCheckout(checkoutForm()),
      );

      expect(redirectParams(url).get("error")).toBe(
        "This workspace already has a subscription. Use Manage subscription to change it.",
      );
      // A second checkout would double-bill the customer.
      expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
    },
  );

  it("allows a checkout once the subscription has fully lapsed", async () => {
    tenantSetup(serverMock.createClient, {
      companies: () => ({
        data: companyRow({ subscription_status: "canceled" }),
        error: null,
      }),
    });

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(url).toBe("https://checkout.stripe.com/c/pay_test");
    expect(stripeMock.sessionsCreate).toHaveBeenCalledTimes(1);
  });


  it("refuses a submission with no plan", async () => {
    plansMock.findSubscriptionPlan.mockResolvedValue(null);
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm({ plan: "" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Choose a plan to continue.",
    );
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses a plan that is no longer in the catalogue", async () => {
    plansMock.findSubscriptionPlan.mockResolvedValue(null);
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm({ plan: "price_archived" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That plan is no longer available. Pick another one.",
    );
    expect(plansMock.findSubscriptionPlan).toHaveBeenCalledWith(
      "price_archived",
    );
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("reports a catalogue read failure instead of charging a guess", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    plansMock.findSubscriptionPlan.mockRejectedValue(new Error("Stripe is down"));
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe(
      "We could not load the plans just now. Please try again.",
    );
    expect(consoleError).toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("bills the picked price and returns to the billing page", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(stripeMock.sessionsCreate).toHaveBeenCalledWith({
      mode: "subscription",
      customer: "cus_test_123",
      client_reference_id: COMPANY_ID,
      line_items: [{ price: PLAN_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url:
        "https://platform.example.com/acme/settings/billing?checkout=success",
      cancel_url:
        "https://platform.example.com/acme/settings/billing?canceled=1",
      metadata: { company_id: COMPANY_ID },
      subscription_data: { metadata: { company_id: COMPANY_ID } },
    });
    expect(url).toBe("https://checkout.stripe.com/c/pay_test");
    // The company already has a customer, so none is created.
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
  });

  it("creates and stores a customer for a company that has none", async () => {
    const mock = tenantSetup(serverMock.createClient, {
      companies: (calls) =>
        calls.some((call) => call.method === "update")
          ? { data: null, error: null }
          : { data: companyRow({ stripe_customer_id: null }), error: null },
    });

    await captureRedirect(() => startSubscriptionCheckout(checkoutForm()));

    expect(stripeMock.customersCreate).toHaveBeenCalledWith({
      name: "Acme Studio",
      email: "owner@example.com",
      metadata: {
        company_id: COMPANY_ID,
        company_slug: "acme",
        owner_user_id: "user-1",
      },
    });
    // Persisted before the checkout, so reconciliation can find the
    // subscription even if the webhook never arrives.
    expect(mock.argsFor("companies", "update")).toEqual([
      [{ stripe_customer_id: "cus_new" }],
    ]);
    expect(mock.argsFor("companies", "eq").at(-1)).toEqual(["id", COMPANY_ID]);
    expect(stripeMock.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" }),
    );
  });

  it("stops when the new customer id cannot be stored", async () => {
    tenantSetup(serverMock.createClient, {
      companies: (calls) =>
        calls.some((call) => call.method === "update")
          ? { data: null, error: { message: "permission denied" } }
          : { data: companyRow({ stripe_customer_id: null }), error: null },
    });

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe("permission denied");
    // A checkout whose customer is not on the company would be unreconcilable.
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("reports a Stripe failure instead of leaving the buyer on a blank page", async () => {
    tenantSetup(serverMock.createClient);
    stripeMock.sessionsCreate.mockRejectedValue(new Error("rate limited"));

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe("rate limited");
  });

  it("reports a checkout session with no URL", async () => {
    tenantSetup(serverMock.createClient);
    stripeMock.sessionsCreate.mockResolvedValue({ url: null });

    const url = await captureRedirect(() =>
      startSubscriptionCheckout(checkoutForm()),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Stripe did not return a checkout URL.",
    );
  });
});

