import { describe, expect, it } from "vitest";

import {
  isWorkspaceWritable,
  READ_ONLY_MESSAGE,
  WRITABLE_STATUSES,
} from "@/lib/billing/entitlements";
import { hasLiveSubscription } from "@/lib/billing/sync";
import type { SubscriptionStatus } from "@/lib/supabase/types";

/**
 * Every value of `subscription_status`, as the migration declares them.
 *
 * Spelled out rather than derived from the type: a new enum member must be
 * classified here on purpose, and the schema test reads the migration to make
 * sure this list is still the whole column.
 */
const ALL_STATUSES: SubscriptionStatus[] = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
];

describe("isWorkspaceWritable", () => {
  it.each(["active", "trialing"] as const)(
    "lets a settled subscription (%s) write",
    (status) => {
      expect(isWorkspaceWritable(status)).toBe(true);
    },
  );

  it("lets a workspace write while Stripe is still retrying the card", () => {
    // `past_due` can become `active` again without anyone touching anything, so
    // closing writes here would punish the customer for their bank's timing.
    expect(isWorkspaceWritable("past_due")).toBe(true);
  });

  it.each([
    "none",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ] as const)("closes writes for %s", (status) => {
    expect(isWorkspaceWritable(status)).toBe(false);
  });

  it("classifies every status in the column, with none left over", () => {
    const writable = ALL_STATUSES.filter(isWorkspaceWritable);
    const readOnly = ALL_STATUSES.filter((status) => !isWorkspaceWritable(status));

    // Sorted: this asserts membership, not the order the list happens to be in.
    expect(writable.sort()).toEqual([...WRITABLE_STATUSES].sort());
    expect(writable.length + readOnly.length).toBe(ALL_STATUSES.length);
    expect(new Set([...writable, ...readOnly])).toEqual(new Set(ALL_STATUSES));
  });

  it("is narrower than what the billing portal can manage", () => {
    // `hasLiveSubscription` answers "is there a subscription Stripe will let us
    // repair?", which is why it counts `unpaid`, `paused` and `incomplete`. That
    // is a different question: those workspaces can still pay, but not write.
    for (const status of ALL_STATUSES) {
      if (isWorkspaceWritable(status)) {
        expect(hasLiveSubscription(status)).toBe(true);
      }
    }

    expect(ALL_STATUSES.filter((status) => !isWorkspaceWritable(status))).toEqual(
      expect.arrayContaining(["unpaid", "paused", "incomplete"]),
    );
  });
});

describe("the read-only sentence", () => {
  it("says where the card is fixed, because that is the way out", () => {
    expect(READ_ONLY_MESSAGE).toContain("read-only");
    expect(READ_ONLY_MESSAGE).toContain("Settings → Billing");
  });
});
