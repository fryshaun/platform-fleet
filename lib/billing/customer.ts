import type Stripe from "stripe";

/**
 * The proof that a Stripe customer is the one a workspace may act on.
 *
 * A customer id is read out of our own row, so it is only as trustworthy as the
 * column — and `stripe_customer_id` is exactly the column a browser used to be
 * able to repoint (see `20260101001000_company_billing_guard.sql`). The two
 * places that turn a stored id into something with consequences, the billing
 * portal and a checkout session, ask Stripe who the customer is first.
 */
export type CustomerOwnership =
  | { ok: true }
  | { ok: false; reason: "deleted" | "mismatch" | "unreadable" };

/**
 * Reads a customer back and checks it against the company that claims it.
 *
 * `customers.create()` stamps `company_id` on every customer this app makes;
 * the ones onboarding created before that stamp existed carry the slug they were
 * created with. A customer with neither — a hand-made one in the dashboard, or
 * one whose metadata was cleared — matches nothing and is refused.
 *
 * The three failures are kept apart because the two callers answer them
 * differently: `unreadable` is a transient Stripe problem, while `deleted` and
 * `mismatch` mean the id itself is wrong.
 */
export async function readOwnedCustomer(
  stripe: Stripe,
  customerId: string,
  company: { id: string; slug: string },
): Promise<CustomerOwnership> {
  let customer: Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer>;

  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (error) {
    console.error(
      `Could not read Stripe customer ${customerId} for ${company.id}:`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: "unreadable" };
  }

  if (customer.deleted) {
    return { ok: false, reason: "deleted" };
  }

  const owned = customer.metadata.company_id
    ? customer.metadata.company_id === company.id
    : customer.metadata.company_slug === company.slug;

  return owned ? { ok: true } : { ok: false, reason: "mismatch" };
}
