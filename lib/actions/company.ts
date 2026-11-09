"use server";

import { redirect } from "next/navigation";

import { buildSubscriptionData } from "@/lib/billing/checkout";
import type { SubscriptionPlan } from "@/lib/plans";
import { getOrigin } from "@/lib/site";
import { SLUG_PROBLEM_MESSAGES, slugify, validateSlug } from "@/lib/slug";
import { getStripe } from "@/lib/stripe";
import { findSubscriptionPlan } from "@/lib/subscriptions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CompanyFormState = {
  error: string | null;
};

/**
 * Creates the company, makes the caller its owner, then hands off to Stripe
 * Checkout for the subscription the caller picked.
 *
 * Company provisioning runs through the service-role client: the normal RLS
 * policies key off existing membership, which by definition does not exist yet
 * for a brand-new tenant.
 */
export async function createCompanyAndCheckout(
  _previousState: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  }

  const name = String(formData.get("name") ?? "").trim();
  const requestedSlug = String(formData.get("slug") ?? "").trim();
  const priceId = String(formData.get("plan") ?? "").trim();
  const slug = slugify(requestedSlug === "" ? name : requestedSlug);

  if (name.length < 2) {
    return { error: "Enter your company name." };
  }

  const slugProblem = validateSlug(slug);
  if (slugProblem) {
    return { error: SLUG_PROBLEM_MESSAGES[slugProblem] };
  }

  // Validate the plan before anything is created: a price that no longer
  // exists would otherwise provision a workspace and then fail at Stripe.
  let plan: SubscriptionPlan | null;
  try {
    plan = await findSubscriptionPlan(priceId);
  } catch (error) {
    console.error("Could not read the subscription plans from Stripe:", error);
    return {
      error: "We could not load the plans just now. Please try again.",
    };
  }

  if (!plan) {
    return {
      error: priceId
        ? "That plan is no longer available. Pick another one."
        : "Choose a plan to continue.",
    };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return { error: "That workspace address is already taken." };
  }

  const stripe = getStripe();
  const origin = await getOrigin();

  let checkoutUrl: string | null = null;
  let createdCompanyId: string | null = null;

  try {
    const customer = await stripe.customers.create({
      name,
      email: user.email ?? undefined,
      metadata: { company_slug: slug, owner_user_id: user.id },
    });

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name, slug, stripe_customer_id: customer.id })
      .select("id")
      .single();

    if (companyError || !company) {
      throw new Error(companyError?.message ?? "Could not create the company.");
    }
    createdCompanyId = company.id;

    const { error: membershipError } = await admin
      .from("company_members")
      .insert({ company_id: company.id, user_id: user.id, role: "owner" });

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      client_reference_id: company.id,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/${slug}/dashboard?checkout=success`,
      cancel_url: `${origin}/onboarding?canceled=1`,
      metadata: { company_id: company.id },
      subscription_data: buildSubscriptionData(company.id, plan),
    });

    checkoutUrl = session.url;

    if (!checkoutUrl) {
      throw new Error("Stripe did not return a checkout URL.");
    }
  } catch (error) {
    // Roll the company back so a failed checkout does not strand an unusable
    // workspace and keep the slug occupied.
    if (createdCompanyId) {
      await admin.from("companies").delete().eq("id", createdCompanyId);
    }
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    };
  }

  redirect(checkoutUrl);
}
