import { headers } from "next/headers";
import type Stripe from "stripe";

import { syncSubscription } from "@/lib/billing/sync";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe webhook receiver.
 *
 * Runs with the service-role client because Stripe is not an authenticated
 * Supabase user. Every handler is written to be idempotent: Stripe retries
 * deliveries, so applying the same subscription state twice must be harmless.
 *
 * Deployment assumptions: the endpoint is registered for snapshot payloads and
 * only the subscription events the switch below handles, and the key it
 * authenticates outbound calls with needs Customers/Checkout/Billing Portal
 * `Write` plus Subscriptions `Read` — nothing more.
 *
 * This is the fast path, not the only one: `lib/billing/sync.ts` also re-reads
 * the subscription whenever a page renders it, so a delivery this endpoint
 * never receives cannot strand a paying company.
 */
export async function POST(request: Request) {
  const signature = (await headers()).get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return new Response("Webhook is not configured", { status: 500 });
  }

  const payload = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    // Async variant works on runtimes without synchronous crypto.
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Stripe webhook signature verification failed:", message);
    return new Response(`Invalid signature: ${message}`, { status: 400 });
  }

  if (isMismatchedMode(event)) {
    // A valid signature only proves the event came from *a* Stripe endpoint we
    // configured. Pasting a test endpoint's signing secret into production
    // would let test-mode events verify against a live deployment and, on a
    // shared database, overwrite real subscription state.
    //
    // The usual cause is a test-mode `STRIPE_SECRET_KEY` in a production
    // environment: every event then arrives with `livemode: false`. The
    // subscription pages re-read Stripe directly, so a live subscription still
    // shows up there even while this endpoint is refusing deliveries.
    console.error(
      `Refusing ${event.type} (${event.id}): test-mode event reached production. ` +
        "Check that STRIPE_SECRET_KEY is a live key for this environment.",
    );
    return new Response("Event livemode mismatch", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(subscription);
        }
        break;
      }

      // Pause and resume also arrive as `updated`, but listing the dedicated
      // event types keeps the state machine from depending on that detail.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object);
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (error) {
    // A 5xx tells Stripe to retry later, which is what we want on a transient
    // database failure.
    console.error(`Failed to process ${event.type}:`, error);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
}

/**
 * True when a test-mode event reaches a production deployment.
 *
 * Signature verification cannot catch this: a test endpoint's signing secret
 * verifies a test-mode event perfectly well. `VERCEL_ENV` is only set on
 * Vercel, so `stripe listen` traffic locally and the test suite (which never
 * sets it) are unaffected.
 */
function isMismatchedMode(event: Stripe.Event): boolean {
  return process.env.VERCEL_ENV === "production" && !event.livemode;
}
