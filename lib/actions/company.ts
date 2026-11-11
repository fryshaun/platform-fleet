"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getActionContext,
  requireAdministrator,
  type ServerSupabase,
} from "@/lib/actions/support";
import { buildSubscriptionData } from "@/lib/billing/checkout";
import {
  COMPANY_LOGOS_BUCKET,
  COMPANY_LOGO_MAX_BYTES,
  companyLogoPath,
  companyLogoStoragePath,
  companyLogoTypeFor,
  isCompanyLogoPath,
} from "@/lib/company";
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

// -----------------------------------------------------------------------------
// Workspace logo
// -----------------------------------------------------------------------------
/**
 * Uploading a workspace mark works the way the account photo does: the browser
 * PUTs the file straight into Storage through a signed URL, then tells a second
 * action that it landed.
 *
 * `getActionContext` + `requireAdministrator` is the whole authorization check
 * here — a logo is company data, so the caller has to be an owner or an admin of
 * *this* company, not merely a manager. The bucket's write policies say the same
 * thing in SQL, which is what stops a hand-written request that skips these.
 *
 * These actions answer instead of redirecting, like the avatar ones: they are
 * called from a form on the settings screen, and a redirect would throw away the
 * message they carry.
 */

export type LogoUploadTarget =
  | { ok: true; path: string; token: string; publicUrl: string }
  | { ok: false; message: string };

export type CompanyLogoResult =
  | { ok: true; message: string; url: string | null }
  | { ok: false; message: string };

/** Hands the browser a one-object upload slot inside this company's folder. */
export async function createLogoUploadUrl(input: {
  slug: string;
  contentType: string;
  size: number;
}): Promise<LogoUploadTarget> {
  const context = await getActionContext(input.slug);
  requireAdministrator(context, input.slug);

  const type = companyLogoTypeFor(input.contentType);
  if (!type) {
    return { ok: false, message: "Upload a PNG, JPEG, WebP or AVIF image." };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (input.size > COMPANY_LOGO_MAX_BYTES) {
    return { ok: false, message: "Keep logos under 2 MB." };
  }

  const path = companyLogoPath(
    context.company.id,
    `${randomUUID()}.${type.extension}`,
  );

  const { data, error } = await context.supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Could not start the upload.",
    };
  }

  return {
    ok: true,
    path: data.path,
    token: data.token,
    publicUrl: context.supabase.storage
      .from(COMPANY_LOGOS_BUCKET)
      .getPublicUrl(data.path).data.publicUrl,
  };
}

/**
 * Records an upload that has already landed, and forgets the one it replaces.
 *
 * The path is re-checked against this company's folder, so a modified client
 * cannot point `companies.logo_url` at another workspace's object — the storage
 * policies would refuse the write anyway, but a stray URL in the column would
 * still render in the rail.
 */
export async function setCompanyLogo(input: {
  slug: string;
  path: string;
  contentType: string;
}): Promise<CompanyLogoResult> {
  const context = await getActionContext(input.slug);
  requireAdministrator(context, input.slug);

  if (
    !companyLogoTypeFor(input.contentType) ||
    !isCompanyLogoPath(input.path, context.company.id)
  ) {
    return { ok: false, message: "That upload does not belong to this workspace." };
  }

  const publicUrl = context.supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .getPublicUrl(input.path).data.publicUrl;

  const { error } = await context.supabase
    .from("companies")
    .update({ logo_url: publicUrl })
    .eq("id", context.company.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await removeStoredLogo(context.supabase, context.company.logo_url);

  // The rail draws the mark, and the chooser lists every workspace — so the
  // invalidation starts at the root layout rather than at this tenant.
  revalidatePath("/", "layout");
  return { ok: true, message: "Logo updated.", url: publicUrl };
}

/** Clears the mark, so the rail falls back to the badge or the initials. */
export async function removeCompanyLogo(input: {
  slug: string;
}): Promise<CompanyLogoResult> {
  const context = await getActionContext(input.slug);
  requireAdministrator(context, input.slug);

  const { error } = await context.supabase
    .from("companies")
    .update({ logo_url: null })
    .eq("id", context.company.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await removeStoredLogo(context.supabase, context.company.logo_url);

  revalidatePath("/", "layout");
  return { ok: true, message: "Logo removed.", url: null };
}

/**
 * Deletes the object behind a URL this app wrote.
 *
 * A URL that is not ours — an empty column, or a link somebody pasted in —
 * resolves to `null` and is left alone. A failed delete is logged rather than
 * raised: the company already points at the new mark, and an orphan object is
 * cheaper than an error in the admin's face.
 */
async function removeStoredLogo(
  supabase: ServerSupabase,
  url: string | null,
): Promise<void> {
  const path = companyLogoStoragePath(url);
  if (!path) {
    return;
  }

  const { error } = await supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .remove([path]);

  if (error) {
    console.error("Could not remove the previous logo:", error.message);
  }
}
