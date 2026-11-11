import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_PRICE_ID, formDataOf, planFixture } from "../helpers/fixtures";
import {
  captureRedirect,
  redirectParams,
  redirectPath,
} from "../helpers/redirect";
import {
  createSupabaseMock,
  signedInUser,
  signedOutUser,
  type TableHandler,
} from "../helpers/supabase";

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  customersUpdate: vi.fn(),
  sessionsCreate: vi.fn(),
}));

const plansMock = vi.hoisted(() => ({ findSubscriptionPlan: vi.fn() }));

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("@/lib/site", () => ({
  getOrigin: async () => "https://platform.example.com",
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: {
      create: stripeMock.customersCreate,
      update: stripeMock.customersUpdate,
    },
    checkout: { sessions: { create: stripeMock.sessionsCreate } },
  }),
}));

// The catalogue is read from Stripe in production; the action's contract is
// "resolve the submitted price id, refuse anything else", so that lookup is
// what these tests stub.
vi.mock("@/lib/subscriptions", () => ({
  findSubscriptionPlan: plansMock.findSubscriptionPlan,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: adminMock.createAdminClient,
}));

const { createCompanyAndCheckout } = await import("@/lib/actions/company");

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const IDLE = { error: null as string | null };

/** A whole onboarding submission, so a test only states what it changes. */
function onboardingForm(overrides: Record<string, string> = {}) {
  return formDataOf({
    name: "Acme Studio",
    slug: "acme",
    plan: PLAN_PRICE_ID,
    ...overrides,
  });
}


type AdminTables = {
  slugTaken?: boolean;
  companyId?: string;
  companyError?: { message: string } | null;
  membershipError?: { message: string } | null;
};

/** Wires the admin client for the provisioning flow. */
function useAdmin(tables: AdminTables = {}) {
  const handlers: Record<string, TableHandler> = {
    companies: (calls) => {
      if (calls.some((call) => call.method === "insert")) {
        return tables.companyError
          ? { data: null, error: tables.companyError }
          : { data: { id: tables.companyId ?? COMPANY_ID }, error: null };
      }
      if (calls.some((call) => call.method === "delete")) {
        return { data: null, error: null };
      }
      return { data: tables.slugTaken ? { id: "taken" } : null, error: null };
    },
    company_members: () => ({
      data: null,
      error: tables.membershipError ?? null,
    }),
  };

  const mock = createSupabaseMock({ tables: handlers });
  adminMock.createAdminClient.mockReturnValue(mock.client);
  return mock;
}

function signedIn() {
  serverMock.createClient.mockResolvedValue(
    createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedInUser()) },
    }).client,
  );
}

function signedOut() {
  serverMock.createClient.mockResolvedValue(
    createSupabaseMock({
      auth: { getUser: vi.fn(async () => signedOutUser()) },
    }).client,
  );
}

describe("createCompanyAndCheckout", () => {
  beforeEach(() => {
    stripeMock.customersCreate.mockReset();
    stripeMock.customersUpdate.mockReset();
    stripeMock.sessionsCreate.mockReset();
    plansMock.findSubscriptionPlan.mockReset();
    adminMock.createAdminClient.mockReset();

    stripeMock.customersCreate.mockResolvedValue({ id: "cus_new" });
    stripeMock.customersUpdate.mockResolvedValue({ id: "cus_new" });
    stripeMock.sessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay_test",
    });
    plansMock.findSubscriptionPlan.mockResolvedValue(planFixture());
  });

  describe("authorisation", () => {
    it("sends an anonymous caller to login and keeps the onboarding target", async () => {
      signedOut();

      const url = await captureRedirect(() =>
        createCompanyAndCheckout(IDLE, onboardingForm()),
      );

      expect(redirectPath(url)).toBe("/login");
      expect(redirectParams(url).get("next")).toBe("/onboarding");
      expect(adminMock.createAdminClient).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    beforeEach(() => signedIn());

    it("rejects a too-short company name", async () => {
      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ name: "A" }),
      );

      expect(state.error).toBe("Enter your company name.");
      expect(stripeMock.customersCreate).not.toHaveBeenCalled();
      expect(adminMock.createAdminClient).not.toHaveBeenCalled();
    });

    it("rejects a reserved workspace address", async () => {
      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ name: "Admin Tools", slug: "admin" }),
      );

      expect(state.error).toBe(
        "That address is reserved. Please pick another.",
      );
      expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    });

    it("rejects an address that slugifies to nothing", async () => {
      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ name: "!!!", slug: "" }),
      );

      expect(state.error).toBe("Choose a workspace address.");
    });

    it("rejects an address that is too short to pass the column check", async () => {
      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ name: "AB", slug: "ab" }),
      );

      expect(state.error).toBe("Use at least 3 characters.");
    });

    it("reports a taken address without touching Stripe", async () => {
      useAdmin({ slugTaken: true });

      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm(),
      );

      expect(state.error).toBe("That workspace address is already taken.");
      expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    });

    it("refuses a submission that did not pick a plan", async () => {
      plansMock.findSubscriptionPlan.mockResolvedValue(null);

      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ plan: "" }),
      );

      expect(state.error).toBe("Choose a plan to continue.");
      // Nothing is created for a checkout that cannot be completed.
      expect(adminMock.createAdminClient).not.toHaveBeenCalled();
      expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    });

    it("refuses a plan that is no longer in the catalogue", async () => {
      plansMock.findSubscriptionPlan.mockResolvedValue(null);

      const state = await createCompanyAndCheckout(
        IDLE,
        onboardingForm({ plan: "price_archived" }),
      );

      expect(state.error).toBe("That plan is no longer available. Pick another one.");
      expect(plansMock.findSubscriptionPlan).toHaveBeenCalledWith(
        "price_archived",
      );
      expect(adminMock.createAdminClient).not.toHaveBeenCalled();
    });

    it("reports a catalogue read failure without provisioning anything", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      plansMock.findSubscriptionPlan.mockRejectedValue(new Error("Stripe is down"));

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe(
        "We could not load the plans just now. Please try again.",
      );
      expect(consoleError).toHaveBeenCalled();
      expect(adminMock.createAdminClient).not.toHaveBeenCalled();
      expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    });
  });


  describe("provisioning", () => {
    beforeEach(() => signedIn());

    it("creates the customer, the company, the owner and the subscription checkout", async () => {
      const admin = useAdmin();

      const url = await captureRedirect(() =>
        createCompanyAndCheckout(IDLE, onboardingForm()),
      );

      expect(url).toBe("https://checkout.stripe.com/c/pay_test");

      expect(stripeMock.customersCreate).toHaveBeenCalledWith({
        name: "Acme Studio",
        email: "owner@example.com",
        metadata: { company_slug: "acme", owner_user_id: "user-1" },
      });

      expect(admin.argsFor("companies", "insert")).toEqual([
        [{ name: "Acme Studio", slug: "acme", stripe_customer_id: "cus_new" }],
      ]);
      expect(admin.argsFor("company_members", "insert")).toEqual([
        [
          {
            company_id: COMPANY_ID,
            user_id: "user-1",
            role: "owner",
          },
        ],
      ]);

      // `openBillingPortal` proves the customer belongs to this workspace, so the
      // id is stamped on the customer as soon as the row has an id to stamp.
      expect(stripeMock.customersUpdate).toHaveBeenCalledWith("cus_new", {
        metadata: { company_id: COMPANY_ID },
      });
    });

    it("still onboards when the customer cannot be stamped", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      useAdmin();
      stripeMock.customersUpdate.mockRejectedValue(new Error("rate limited"));

      const url = await captureRedirect(() =>
        createCompanyAndCheckout(IDLE, onboardingForm()),
      );

      // The portal falls back to the slug every onboarding customer carries, so
      // a cosmetic failure must not strand a workspace that is ready.
      expect(url).toBe("https://checkout.stripe.com/c/pay_test");
      expect(stripeMock.sessionsCreate).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("bills the price the caller picked, not a configured default", async () => {
      useAdmin();

      await captureRedirect(() =>
        createCompanyAndCheckout(IDLE, onboardingForm({ plan: PLAN_PRICE_ID })),
      );

      expect(plansMock.findSubscriptionPlan).toHaveBeenCalledWith(
        PLAN_PRICE_ID,
      );
      expect(stripeMock.sessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          customer: "cus_new",
          client_reference_id: COMPANY_ID,
          line_items: [{ price: PLAN_PRICE_ID, quantity: 1 }],
        }),
      );
    });

    it("sends the buyer back to the workspace they just created", async () => {
      useAdmin();

      await captureRedirect(() => createCompanyAndCheckout(IDLE, onboardingForm()));

      expect(stripeMock.sessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url:
            "https://platform.example.com/acme/dashboard?checkout=success",
          cancel_url: "https://platform.example.com/onboarding?canceled=1",
        }),
      );
    });

    it("carries the plan's trial into the subscription metadata", async () => {
      useAdmin();
      plansMock.findSubscriptionPlan.mockResolvedValue(
        planFixture({ trialDays: 14 }),
      );

      await captureRedirect(() =>
        createCompanyAndCheckout(
          IDLE,
          onboardingForm({ plan: PLAN_PRICE_ID }),
        ),
      );

      const [[sessionArgs]] = stripeMock.sessionsCreate.mock.calls as [
        [{ subscription_data: Record<string, unknown> }],
      ];

      expect(sessionArgs.subscription_data).toEqual({
        metadata: { company_id: COMPANY_ID },
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      });
    });

    it("derives the address from the name when none was typed", async () => {
      const admin = useAdmin();

      await captureRedirect(() =>
        createCompanyAndCheckout(IDLE, onboardingForm({ slug: "" })),
      );

      expect(admin.argsFor("companies", "insert")).toEqual([
        [
          {
            name: "Acme Studio",
            slug: "acme-studio",
            stripe_customer_id: "cus_new",
          },
        ],
      ]);
    });

    it("slugifies a messy address before it reaches the insert", async () => {
      const admin = useAdmin();

      await captureRedirect(() =>
        createCompanyAndCheckout(
          IDLE,
          onboardingForm({ slug: "  Acme  Studio!! " }),
        ),
      );

      expect(admin.argsFor("companies", "insert")).toEqual([
        [
          {
            name: "Acme Studio",
            slug: "acme-studio",
            stripe_customer_id: "cus_new",
          },
        ],
      ]);
    });
  });


  describe("failure handling", () => {
    beforeEach(() => signedIn());

    it("stops before provisioning when Stripe cannot create the customer", async () => {
      const admin = useAdmin();
      stripeMock.customersCreate.mockRejectedValue(new Error("card network down"));

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe("card network down");
      expect(admin.argsFor("companies", "insert")).toEqual([]);
    });

    it("surfaces the database message when the company insert fails", async () => {
      const admin = useAdmin({
        companyError: { message: "duplicate key value" },
      });

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe("duplicate key value");
      // Nothing was created, so there is nothing to roll back.
      expect(admin.argsFor("companies", "delete")).toEqual([]);
    });

    it("deletes the half-built company when the owner membership fails", async () => {
      const admin = useAdmin({
        membershipError: { message: "insert failed" },
      });

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe("insert failed");
      expect(admin.chainsFor("companies").at(-1)).toEqual([
        { method: "delete", args: [] },
        { method: "eq", args: ["id", COMPANY_ID] },
      ]);
      expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
    });

    it("rolls the company back when Stripe returns no checkout URL", async () => {
      const admin = useAdmin();
      stripeMock.sessionsCreate.mockResolvedValue({ url: null });

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe("Stripe did not return a checkout URL.");
      expect(admin.chainsFor("companies").at(-1)).toEqual([
        { method: "delete", args: [] },
        { method: "eq", args: ["id", COMPANY_ID] },
      ]);
    });

    it("falls back to a generic message when something odd is thrown", async () => {
      useAdmin();
      stripeMock.customersCreate.mockRejectedValue("boom");

      const state = await createCompanyAndCheckout(IDLE, onboardingForm());

      expect(state.error).toBe("Something went wrong. Please try again.");
    });
  });
});

