import "server-only";

import Stripe from "stripe";

let cachedClient: Stripe | null = null;

/**
 * Lazily constructed Stripe client.
 *
 * Constructing at module scope would throw during `next build` when the secret
 * is absent, so it is created on first use instead.
 *
 * Which prices a company can subscribe to is not configured here: the catalogue
 * is read from the account (see `lib/subscriptions.ts`), so adding a plan is a
 * Dashboard change rather than a deploy.
 */
export function getStripe(): Stripe {
  if (!cachedClient) {
    cachedClient = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      appInfo: { name: "platform", version: "0.1.0" },
    });
  }
  return cachedClient;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
