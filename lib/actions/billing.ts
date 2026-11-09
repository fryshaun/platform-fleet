"use server";

import { redirect } from "next/navigation";

import { buildSubscriptionData } from "@/lib/billing/checkout";
import { hasLiveSubscription } from "@/lib/billing/sync";
import type { SubscriptionPlan } from "@/lib/plans";
import { getOrigin } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { findSubscriptionPlan } from "@/lib/subscriptions";
import {
  getActionContext,
  readField,
  redirectWith,
} from "@/lib/actions/support";
import { canAdminister } from "@/lib/roles";

const BILLING_REFUSED = "Only owners and admins can manage billing.";

/**
 * Opens the Stripe billing portal for the current company.
 *
 * The portal is where card details, invoices and cancellation live, so the app
 * never has to build its own billing UI.
 */
export async function openBillingPortal(formData: FormData) {
  const slug = readField(formData, "slug");
  if (!slug) {
    redirect("/workspaces");
  }

  const { company, role } = await getActionContext(slug);

  if (!canAdminister(role)) {
    redirectWith(slug, "settings/billing", { error: BILLING_REFUSED });
  }

  if (!company.stripe_customer_id) {
    redirectWith(slug, "settings/billing", {
      error: "This company has no Stripe customer yet. Start a checkout first.",
    });
  }

  const origin = await getOrigin();
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripe_customer_id,
    return_url: `${origin}/${slug}/settings/billing`,
  });

  redirect(session.url);
}

/**
 * Starts a Checkout for a company that has no active subscription.
 *
 * The counterpart to onboarding for a workspace that already exists: the
 * billing portal can only manage a subscription that Stripe already knows
 * about, so a company whose earlier checkout was abandoned (or whose
 * subscription lapsed) has no way back to a paid state without this.
 */
export async function startSubscriptionCheckout(formData: FormData) {
  const slug = readField(formData, "slug");
  if (!slug) {
    redirect("/workspaces");
  }

  const { supabase, company, role, user } = await getActionContext(slug);

  if (!canAdminister(role)) {
    redirectWith(slug, "settings/billing", { error: BILLING_REFUSED });
  }

  if (hasLiveSubscription(company.subscription_status)) {
    redirectWith(slug, "settings/billing", {
      error:
        "This workspace already has a subscription. Use Manage subscription to change it.",
    });
  }

  const priceId = readField(formData, "plan");

  let plan: SubscriptionPlan | null;
  try {
    plan = await findSubscriptionPlan(priceId);
  } catch (error) {
    console.error("Could not read the subscription plans from Stripe:", error);
    redirectWith(slug, "settings/billing", {
      error: "We could not load the plans just now. Please try again.",
    });
  }

  if (!plan) {
    redirectWith(slug, "settings/billing", {
      error: priceId
        ? "That plan is no longer available. Pick another one."
        : "Choose a plan to continue.",
    });
  }

  const origin = await getOrigin();
  const stripe = getStripe();

  let checkoutUrl: string;

  try {
    let customerId = company.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: company.name,
        email: user.email || undefined,
        metadata: {
          company_id: company.id,
          company_slug: company.slug,
          owner_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Persist before checkout so reconciliation can read the subscription
      // back by customer even if the webhook never lands. `companies` is
      // updatable by owners and admins under RLS, so the request-scoped client
      // is enough here.
      const { error } = await supabase
        .from("companies")
        .update({ stripe_customer_id: customerId })
        .eq("id", company.id);

      if (error) {
        throw new Error(error.message);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: company.id,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/${slug}/settings/billing?checkout=success`,
      cancel_url: `${origin}/${slug}/settings/billing?canceled=1`,
      metadata: { company_id: company.id },
      subscription_data: buildSubscriptionData(company.id, plan),
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    checkoutUrl = session.url;
  } catch (error) {
    redirectWith(slug, "settings/billing", {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    });
  }

  redirect(checkoutUrl);
}

