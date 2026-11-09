import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/stripe.ts` memoises the client in module scope, so each test gets a fresh
 * module registry. That also verifies the lazy construction: importing the
 * module must never throw, even with no environment configured.
 */
async function loadStripeModule() {
  vi.resetModules();
  return import("@/lib/stripe");
}

describe("lib/stripe", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("imports cleanly with no configuration", async () => {
    // Constructing at module scope would break `next build`; this is the guard.
    await expect(loadStripeModule()).resolves.toBeDefined();
  });

  describe("getStripe", () => {
    it("throws a named error when the secret key is unset", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      const { getStripe } = await loadStripeModule();
      expect(() => getStripe()).toThrow(
        "Missing required environment variable: STRIPE_SECRET_KEY",
      );
    });

    it("constructs a Stripe client once configured", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      const { getStripe } = await loadStripeModule();
      expect(getStripe()).toBeInstanceOf(Stripe);
    });

    it("returns the same instance on repeated calls", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      const { getStripe } = await loadStripeModule();
      expect(getStripe()).toBe(getStripe());
    });

    it("does not cache a failure: a later call succeeds once configured", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      const { getStripe } = await loadStripeModule();
      expect(() => getStripe()).toThrow();

      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      expect(() => getStripe()).not.toThrow();
    });
  });
});
