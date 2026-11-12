import type { SubscriptionStatus } from "@/lib/supabase/types";

/**
 * Whether a workspace may still write, given its subscription status.
 *
 * This is the third question billing asks, and it is not the same as either of
 * the other two:
 *
 *   `hasLiveSubscription()`  (`lib/billing/sync.ts`)   is there a subscription
 *                            Stripe will let us manage, so the billing portal
 *                            can fix it?
 *   `isSectionEnabled()`     (`lib/features.ts`)       has the workspace bought
 *                            this extension at all?
 *   `isWorkspaceWritable()`  (here)                    may this workspace change
 *                            what it stores, right now?
 *
 * `active` and `trialing` are settled. `past_due` is included on purpose:
 * Stripe is still retrying the card and can put the subscription back to
 * `active` by itself, so the workspace keeps writing through the dunning
 * window. Everything else — `none`, `canceled`, `unpaid`, `incomplete`,
 * `incomplete_expired`, `paused` — is read-only: reads keep working, saving
 * stops.
 *
 * `none` is read-only because onboarding ends at Stripe Checkout: a workspace
 * reaches the app only after paying, so `none` is a workspace that cancelled
 * the first checkout, not one that has not been asked yet.
 *
 * The list is enforced twice and the two must agree: `lib/actions/support.ts`
 * asks this function so it can explain itself, and the restrictive policies in
 * `20260101001100_subscription_write_gate.sql` ask
 * `public.has_active_subscription()` so RLS decides for anything that skips the
 * action. `tests/db/schema.test.ts` reads both and fails if they drift.
 */
export const WRITABLE_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const satisfies readonly SubscriptionStatus[];

/** True when the workspace may write; false when it is read-only. */
export function isWorkspaceWritable(status: SubscriptionStatus): boolean {
  return (WRITABLE_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

/**
 * The one sentence every refused write shows.
 *
 * Lives here rather than in the action helpers because the banner on the
 * products and assets pages shows it too, and a reader should not meet two
 * different phrasings of the same rule. It lives in a module with no
 * `server-only` marker so both the Server Action and the Server Component can
 * import it.
 */
export const READ_ONLY_MESSAGE =
  "This workspace is read-only until its subscription is restored. Update the card under Settings → Billing.";

