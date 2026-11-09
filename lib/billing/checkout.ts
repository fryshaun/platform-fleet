import "server-only";

import type Stripe from "stripe";

import type { SubscriptionPlan } from "@/lib/plans";

/**
 * Builds the `subscription_data` both checkout flows send.
 *
 * Every subscription is stamped with the company id so the webhook can find its
 * row, and a plan that grants a trial carries that trial into Stripe. Shared
 * between onboarding (`lib/actions/company.ts`) and re-subscribing from the
 * billing page (`lib/actions/billing.ts`) so the two cannot drift apart.
 */
export function buildSubscriptionData(
  companyId: string,
  plan: Pick<SubscriptionPlan, "trialDays">,
): Stripe.Checkout.SessionCreateParams.SubscriptionData {
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { company_id: companyId },
  };

  if (plan.trialDays) {
    subscriptionData.trial_period_days = plan.trialDays;
    // Checkout only collects a payment method up front when it is required, so
    // a trial can end with nothing to charge. Cancelling is the honest outcome:
    // the alternative parks the subscription in `past_due` and keeps a
    // workspace enabled that never paid.
    subscriptionData.trial_settings = {
      end_behavior: { missing_payment_method: "cancel" },
    };
  }

  return subscriptionData;
}
