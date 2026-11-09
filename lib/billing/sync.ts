import "server-only";

import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionStatus, Tables } from "@/lib/supabase/types";

/**
 * Keeps `companies.subscription_*` in step with Stripe.
 *
 * Stripe is the source of truth. Two paths write that state:
 *
 * - `syncSubscription`, driven by the webhook, which is the fast path;
 * - `reconcileCompanySubscription`, a read-back used by the pages that show the
 *   subscription, which repairs anything the webhook missed.
 *
 * The second exists because a webhook is a best-effort delivery. A dropped
 * event, an endpoint registered for the wrong event types, a rotated signing
 * secret, or a test-mode event refused by a production deployment all leave a
 * paid-for company looking unpaid forever, with no retry that can help.
 */

export type SubscriptionPatch = {
  stripe_subscription_id: string;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
};

export type SubscriptionReconciliation = {
  /** The company row, rewritten when Stripe disagreed with it. */
  company: Tables<"companies">;
  /** The subscription Stripe reports for this customer, when there is one. */
  subscription: Stripe.Subscription | null;
  /** True when the stored row was rewritten from Stripe. */
  changed: boolean;
};

/**
 * Maps a Stripe subscription status onto our enum.
 *
 * `Stripe.Subscription.Status` is an open union that also accepts arbitrary
 * strings, so the values are spelled out rather than returned by reference.
 */
export function mapSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incomplete_expired";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    default:
      return "incomplete";
  }
}

/** True when the workspace is paid for and fully enabled. */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

/**
 * True when Stripe still holds a subscription for the company.
 *
 * `active` and `trialing` are settled; the rest here are states Stripe can move
 * back to `active` on its own once payment is sorted out. Starting a Checkout
 * in any of them would create a *second* subscription rather than fixing the
 * first, so those companies belong in the billing portal.
 */
export function hasLiveSubscription(status: SubscriptionStatus): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused" ||
    status === "incomplete"
  );
}

/** The columns a subscription owns, derived from the Stripe object. */
export function toSubscriptionPatch(
  subscription: Stripe.Subscription,
): SubscriptionPatch {
  return {
    stripe_subscription_id: subscription.id,
    subscription_status: mapSubscriptionStatus(subscription.status),
    trial_ends_at: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
  };
}

/**
 * Applies a Stripe subscription to the company that owns it.
 *
 * Returns the identifier that was matched, or `null` when no row did. A
 * database error throws so the webhook answers 5xx and Stripe retries; a
 * subscription that matches no company is logged and acknowledged, because no
 * amount of retrying changes the outcome.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const admin = createAdminClient();
  const patch = toSubscriptionPatch(subscription);
  const customerId = customerIdOf(subscription);

  // The company id travels in subscription metadata. A subscription created
  // before that metadata existed only has the customer id to go on.
  const companyId = subscription.metadata.company_id;

  const query = companyId
    ? admin.from("companies").update(patch).eq("id", companyId)
    : admin
        .from("companies")
        .update(patch)
        .eq("stripe_customer_id", customerId);

  // Selecting the row back is what turns "no company matched" from a silent
  // no-op into something visible: a bare update reports success either way.
  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Could not update company subscription: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.error(
      `Stripe subscription ${subscription.id} (${subscription.status}) matched no company: ` +
        (companyId
          ? `metadata.company_id=${companyId}`
          : `customer=${customerId}`) +
        ". The next visit to the billing page re-reads it from Stripe.",
    );
    return null;
  }

  return companyId ?? customerId;
}

/**
 * Re-reads the subscription from Stripe and repairs the stored row.
 *
 * Every page that renders subscription state calls this, so a missed webhook
 * heals the first time anyone looks. Stripe being unreachable must never break
 * a render: the error is logged and the stored row is returned unchanged.
 */
export async function reconcileCompanySubscription(
  company: Tables<"companies">,
): Promise<SubscriptionReconciliation> {
  if (!company.stripe_customer_id) {
    return { company, subscription: null, changed: false };
  }

  try {
    const stripe = getStripe();
    const subscriptions = await stripe.subscriptions.list({
      customer: company.stripe_customer_id,
      // Cancelled subscriptions stay in the list with `status=canceled`, and a
      // company that cancelled and later re-subscribed has more than one.
      status: "all",
      limit: 10,
    });

    const subscription = pickSubscription(
      subscriptions.data,
      company.stripe_subscription_id,
    );

    if (!subscription) {
      return { company, subscription: null, changed: false };
    }

    const patch = toSubscriptionPatch(subscription);
    if (isSameSubscriptionState(company, patch)) {
      return { company, subscription, changed: false };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("companies")
      .update(patch)
      .eq("id", company.id);

    if (error) {
      throw new Error(error.message);
    }

    return { company: { ...company, ...patch }, subscription, changed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Could not reconcile the subscription for company ${company.id} from Stripe:`,
      message,
    );
    return { company, subscription: null, changed: false };
  }
}

/**
 * True when the stored row is worth re-reading from Stripe.
 *
 * Keeps healthy workspaces at zero extra API calls: an `active` subscription is
 * the settled state, and the billing page reconciles unconditionally anyway.
 */
export function needsReconciliation(
  company: Pick<
    Tables<"companies">,
    "stripe_customer_id" | "subscription_status" | "trial_ends_at"
  >,
  now: number = Date.now(),
): boolean {
  if (!company.stripe_customer_id) return false;
  if (company.subscription_status === "active") return false;

  if (company.subscription_status === "trialing") {
    // A trial that has run out in the database has almost certainly converted,
    // and no webhook is guaranteed to have told us.
    const trialEndsAt = company.trial_ends_at
      ? new Date(company.trial_ends_at).getTime()
      : null;
    return trialEndsAt === null || trialEndsAt <= now;
  }

  return true;
}

/**
 * Picks the subscription that describes the company today.
 *
 * Prefers the stored one, then any subscription that is not already finished.
 * A cancelled subscription stays in the list forever, so "whichever came back
 * first" would resurrect it after a customer re-subscribed.
 */
export function pickSubscription(
  subscriptions: Stripe.Subscription[],
  preferredId: string | null,
): Stripe.Subscription | null {
  const preferred = preferredId
    ? subscriptions.find((subscription) => subscription.id === preferredId)
    : undefined;

  if (preferred && !isFinished(preferred)) {
    return preferred;
  }

  return (
    subscriptions.find((subscription) => !isFinished(subscription)) ??
    preferred ??
    null
  );
}

function isFinished(subscription: Stripe.Subscription): boolean {
  return (
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired"
  );
}

function customerIdOf(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

function isSameSubscriptionState(
  company: Tables<"companies">,
  patch: SubscriptionPatch,
): boolean {
  return (
    company.stripe_subscription_id === patch.stripe_subscription_id &&
    company.subscription_status === patch.subscription_status &&
    timestampOf(company.trial_ends_at) === timestampOf(patch.trial_ends_at)
  );
}

/** Postgres returns timestamptz in its own format, so compare instants. */
function timestampOf(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? -1 : parsed;
}
