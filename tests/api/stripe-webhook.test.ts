import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stripeSubscription } from "../helpers/stripe";

const stripeMock = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
  retrieve: vi.fn(),
}));

const syncMock = vi.hoisted(() => ({ syncSubscription: vi.fn() }));

const headerStore = vi.hoisted(() => ({ value: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(headerStore.value)),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEventAsync: stripeMock.constructEventAsync },
    subscriptions: { retrieve: stripeMock.retrieve },
  }),
}));

// The route owns *routing*, not reconciliation: which events matter, what they
// are turned into, and which HTTP status Stripe should see. `syncSubscription`
// is covered against a real database mock in tests/unit/billing-sync.test.ts.
vi.mock("@/lib/billing/sync", () => ({
  syncSubscription: syncMock.syncSubscription,
}));

const { POST } = await import("@/app/api/stripe/webhook/route");

/** Builds an event shaped like a snapshot delivery. */
function makeEvent(
  type: string,
  object: unknown,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_${type}`,
    type,
    data: { object },
    livemode: true,
    ...overrides,
  } as unknown as Stripe.Event;
}

function postRequest() {
  return new Request("https://platform.example.com/api/stripe/webhook", {
    method: "POST",
    body: "{}",
  });
}

/** Silences the diagnostic logging the route does on the failure paths. */
function silenceConsole() {
  return {
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  };
}

/** Delivers `event` as if Stripe had sent it correctly signed. */
function deliver(event: Stripe.Event) {
  stripeMock.constructEventAsync.mockResolvedValue(event);
  return POST(postRequest());
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    headerStore.value = new Map([["stripe-signature", "t=1,v1=abc"]]);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("VERCEL_ENV", "");
    stripeMock.constructEventAsync.mockReset();
    stripeMock.retrieve.mockReset();
    syncMock.syncSubscription.mockReset();
    syncMock.syncSubscription.mockResolvedValue("company-1");
  });

  describe("request validation", () => {
    it("rejects a request with no signature header", async () => {
      headerStore.value = new Map();

      const response = await POST(postRequest());

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing stripe-signature header");
      expect(stripeMock.constructEventAsync).not.toHaveBeenCalled();
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
    });

    it("refuses to run when the webhook secret is not configured", async () => {
      const consoleSpy = silenceConsole();
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

      const response = await POST(postRequest());

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Webhook is not configured");
      expect(consoleSpy.error).toHaveBeenCalled();
      expect(stripeMock.constructEventAsync).not.toHaveBeenCalled();
    });

    it("rejects a payload whose signature does not verify", async () => {
      const consoleSpy = silenceConsole();
      stripeMock.constructEventAsync.mockRejectedValue(
        new Error("No signatures found matching the expected signature"),
      );

      const response = await POST(postRequest());

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Invalid signature: No signatures found matching the expected signature",
      );
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe("mode guard", () => {
    it("refuses a test-mode event that reached production", async () => {
      const consoleSpy = silenceConsole();
      vi.stubEnv("VERCEL_ENV", "production");

      const response = await deliver(
        makeEvent("customer.subscription.updated", stripeSubscription(), {
          livemode: false,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Event livemode mismatch");
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
      // The log has to name the usual cause, because the symptom (a paying
      // customer stuck on a paywall) looks nothing like a key problem.
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("test-mode event reached production"),
      );
    });

    it("accepts a test-mode event outside production, as `stripe listen` sends", async () => {
      await deliver(
        makeEvent("customer.subscription.updated", stripeSubscription(), {
          livemode: false,
        }),
      );

      expect(syncMock.syncSubscription).toHaveBeenCalledTimes(1);
    });

    it("accepts a live event in production", async () => {
      vi.stubEnv("VERCEL_ENV", "production");

      const response = await deliver(
        makeEvent("customer.subscription.updated", stripeSubscription()),
      );

      expect(response.status).toBe(200);
      expect(syncMock.syncSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkout.session.completed", () => {
    it("re-reads the subscription named on the session, then syncs it", async () => {
      const subscription = stripeSubscription({ id: "sub_from_session" });
      stripeMock.retrieve.mockResolvedValue(subscription);

      const response = await deliver(
        makeEvent("checkout.session.completed", {
          subscription: "sub_from_session",
        }),
      );

      expect(response.status).toBe(200);
      // The session carries only an id, so the subscription must be fetched
      // before the company can be updated.
      expect(stripeMock.retrieve).toHaveBeenCalledWith("sub_from_session");
      expect(syncMock.syncSubscription).toHaveBeenCalledWith(subscription);
    });

    it("re-reads an expanded subscription instead of trusting the snapshot", async () => {
      const expanded = stripeSubscription({ id: "sub_expanded" });
      const fresh = stripeSubscription({ id: "sub_expanded", status: "active" });
      stripeMock.retrieve.mockResolvedValue(fresh);

      await deliver(makeEvent("checkout.session.completed", { subscription: expanded }));

      // The session payload can be stale by the time it is delivered, so only
      // the id is taken from it.
      expect(stripeMock.retrieve).toHaveBeenCalledWith("sub_expanded");
      expect(syncMock.syncSubscription).toHaveBeenCalledWith(fresh);
    });

    it("acknowledges a session that has no subscription to sync", async () => {
      const response = await deliver(
        makeEvent("checkout.session.completed", { subscription: null }),
      );

      expect(response.status).toBe(200);
      expect(stripeMock.retrieve).not.toHaveBeenCalled();
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
    });
  });

  describe("subscription events", () => {
    it.each([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "customer.subscription.deleted",
    ])("syncs the subscription carried by %s", async (type) => {
      const subscription = stripeSubscription({ status: "canceled" });

      const response = await deliver(makeEvent(type, subscription));

      expect(response.status).toBe(200);
      expect(syncMock.syncSubscription).toHaveBeenCalledWith(subscription);
      // The payload is a snapshot, so no read is needed.
      expect(stripeMock.retrieve).not.toHaveBeenCalled();
    });

    it("acknowledges an event type the app does not model", async () => {
      const response = await deliver(makeEvent("invoice.paid", { id: "in_1" }));

      expect(response.status).toBe(200);
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
    });
  });

  describe("failure handling", () => {
    it("returns 500 so Stripe retries when the sync fails", async () => {
      const consoleSpy = silenceConsole();
      syncMock.syncSubscription.mockRejectedValue(
        new Error("Could not update company subscription: connection reset"),
      );

      const response = await deliver(
        makeEvent("customer.subscription.updated", stripeSubscription()),
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Webhook handler failed");
      expect(consoleSpy.error).toHaveBeenCalledWith(
        "Failed to process customer.subscription.updated:",
        expect.any(Error),
      );
    });

    it("returns 500 when the subscription cannot be retrieved", async () => {
      silenceConsole();
      stripeMock.retrieve.mockRejectedValue(new Error("No such subscription"));

      const response = await deliver(
        makeEvent("checkout.session.completed", {
          subscription: "sub_missing",
        }),
      );

      expect(response.status).toBe(500);
      expect(syncMock.syncSubscription).not.toHaveBeenCalled();
    });

    it("returns an empty 200 once the event is applied", async () => {
      const response = await deliver(
        makeEvent("customer.subscription.updated", stripeSubscription()),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    });
  });
});

