import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole, SubscriptionStatus } from "@/lib/supabase/types";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";

import {
  ASSET_ID,
  BOOKING_ID,
  COMPANY_ID,
  COMPONENT_ID,
  CUSTOMER_ID,
  LINE_ITEM_ID,
  formDataOf,
} from "../helpers/fixtures";
import {
  captureRedirect,
  redirectParams,
  redirectPath,
} from "../helpers/redirect";
import type { DbResult, TableHandler } from "../helpers/supabase";
import { tenantSetup } from "../helpers/tenant";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({
  revalidatePath: cacheMock.revalidatePath,
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const {
  addLineItem,
  assignAsset,
  assignComponent,
  assignRider,
  createBooking,
  deleteBooking,
  removeLineItem,
  setBookingStatus,
  updateBooking,
  updateLineItem,
} = await import("@/lib/actions/bookings");

type SetupOptions = {
  handlers?: Record<string, TableHandler>;
  sections?: string[];
  subscription?: SubscriptionStatus;
  rpc?: Record<string, (args?: unknown) => DbResult>;
};

/**
 * The section is on, the workspace is paying and the caller is at the desk
 * unless a test says otherwise; `handlers` supplies only the tables the action
 * under test reads.
 */
function setup(role: MemberRole = "staff", options: SetupOptions = {}) {
  return tenantSetup(serverMock.createClient, options.handlers ?? {}, role, {
    sections: options.sections ?? ["bookings"],
    subscription: options.subscription ?? "active",
    rpc: options.rpc,
  });
}

/** The smallest valid booking form. */
const DRAFT = {
  slug: "acme",
  customer_id: CUSTOMER_ID,
  starts_on: "2026-03-04",
  ends_on: "2026-03-08",
  status: "pending",
};

/** The hidden fields every action after `createBooking` receives. */
const BOOKING = {
  slug: "acme",
  booking_id: BOOKING_ID,
  reference: "BK-7F3K2Q",
};

beforeEach(() => cacheMock.revalidatePath.mockReset());

describe("createBooking", () => {
  it("denies a viewer", async () => {
    setup("member");

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", { sections: [] });

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "That extension is not enabled for this workspace.",
    );
  });

  it("requires a renter", async () => {
    setup();

    const url = await captureRedirect(() =>
      createBooking(formDataOf({ ...DRAFT, customer_id: "" })),
    );

    expect(redirectPath(url)).toBe("/acme/bookings");
    expect(redirectParams(url).get("error")).toBe(
      "Choose a renter, or add a new one.",
    );
  });

  it("generates the reference and scopes the row to the workspace", async () => {
    const mock = setup("staff", {
      handlers: {
        bookings: () => ({
          data: { reference: "BK-ABC234" },
          error: null,
        }),
      },
    });

    await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    const payload = mock.argFor("bookings", "insert") as Record<string, unknown>;

    expect(payload).toMatchObject({
      company_id: COMPANY_ID,
      customer_id: CUSTOMER_ID,
      status: "pending",
      // The desk is the only writer in this slice.
      channel: "staff",
      starts_on: "2026-03-04",
      ends_on: "2026-03-08",
      currency: "usd",
      created_by: "user-1",
    });
    expect(String(payload.reference)).toMatch(/^BK-[2-9A-HJ-NP-Z]{6}$/);
  });

  it("returns to the booking it just took", async () => {
    setup("staff", {
      handlers: {
        bookings: () => ({ data: { reference: "BK-ABC234" }, error: null }),
      },
    });

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/bookings/BK-ABC234");
    expect(redirectParams(url).get("ok")).toBe("Booking taken.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("records a walk-in before taking the booking", async () => {
    const mock = setup("staff", {
      handlers: {
        customers: () => ({ data: { id: CUSTOMER_ID }, error: null }),
        bookings: () => ({ data: { reference: "BK-ABC234" }, error: null }),
      },
    });

    await captureRedirect(() =>
      createBooking(
        formDataOf({
          ...DRAFT,
          customer_id: "",
          new_customer_name: "Nadia Okafor",
        }),
      ),
    );

    expect(mock.argFor("customers", "insert")).toEqual({
      company_id: COMPANY_ID,
      handle: "nadia-okafor",
      full_name: "Nadia Okafor",
      email: null,
      phone: null,
    });
    expect(mock.argFor("bookings", "insert")).toMatchObject({
      customer_id: CUSTOMER_ID,
    });
  });

  it("explains a renter address that is already on file", async () => {
    const mock = setup("staff", {
      handlers: {
        customers: () => ({
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "customers_email_idx"',
            code: "23505",
          },
        }),
      },
    });

    const url = await captureRedirect(() =>
      createBooking(
        formDataOf({
          ...DRAFT,
          customer_id: "",
          new_customer_name: "Nadia Okafor",
          new_customer_email: "nadia@example.com",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That address is already one of this workspace's renters.",
    );
    // Nothing was booked against a renter the desk could not create.
    expect(mock.methodsFor("bookings")).toEqual([]);
  });

  it("retries a colliding reference before giving up", async () => {
    // `23505` is the duplicate reference, never the double-booking.
    const mock = setup("staff", {
      handlers: {
        bookings: () => ({
          data: null,
          error: { message: "duplicate key", code: "23505" },
        }),
      },
    });

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(mock.chainsFor("bookings")).toHaveLength(3);
    expect(redirectParams(url).get("error")).toBe(
      "That booking reference is already in use. Try again.",
    );
  });

  it("does not retry an error the reference cannot fix", async () => {
    const mock = setup("staff", {
      handlers: {
        bookings: () => ({
          data: null,
          error: { message: "permission denied", code: "42501" },
        }),
      },
    });

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(mock.chainsFor("bookings")).toHaveLength(1);
    expect(redirectParams(url).get("error")).toBe("permission denied");
  });
});

describe("updateBooking", () => {
  it("saves the renter and the window but never the status", async () => {
    // The transition table owns the status; an edit must not be able to skip it.
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      updateBooking(formDataOf({ ...DRAFT, ...BOOKING, status: "returned" })),
    );

    const payload = mock.argFor("bookings", "update") as Record<string, unknown>;

    expect(payload).not.toHaveProperty("status");
    expect(payload).toMatchObject({
      customer_id: CUSTOMER_ID,
      starts_on: "2026-03-04",
      ends_on: "2026-03-08",
    });
    expect(mock.argsFor("bookings", "eq")).toEqual([
      ["id", BOOKING_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/bookings/BK-7F3K2Q");
    expect(redirectParams(url).get("ok")).toBe("Booking saved.");
  });

  it("refuses a window that would hold nothing", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      updateBooking(
        formDataOf({ ...DRAFT, ...BOOKING, ends_on: "2026-03-04" }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "The return date must be after the collection date.",
    );
  });

  it("explains a double-booking as a date clash", async () => {
    // `23P01`, not `23505`: the exclusion constraint on the lines.
    setup("staff", {
      handlers: {
        bookings: () => ({
          data: null,
          error: { message: "conflicting key value", code: "23P01" },
        }),
      },
    });

    const url = await captureRedirect(() =>
      updateBooking(formDataOf({ ...DRAFT, ...BOOKING })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That unit is already out on those dates.",
    );
  });
});

describe("setBookingStatus", () => {
  /** Answers the status read, then accepts whatever write follows. */
  function currentStatus(status: string): TableHandler {
    return (_calls, history) =>
      history.length === 1
        ? { data: { status }, error: null }
        : { data: null, error: null };
  }

  it("refuses a move the transition table does not allow", async () => {
    const mock = setup("staff", {
      handlers: { bookings: currentStatus("returned") },
    });

    const url = await captureRedirect(() =>
      setBookingStatus(formDataOf({ ...BOOKING, status: "pending" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "A returned booking cannot be marked pending.",
    );
    expect(mock.methodsFor("bookings")).not.toContain("update");
  });

  it("refuses a status it does not recognise", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      setBookingStatus(formDataOf({ ...BOOKING, status: "rented" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a valid status.");
  });

  it("moves a confirmed booking out and reports it", async () => {
    const mock = setup("staff", {
      handlers: { bookings: currentStatus("confirmed") },
    });

    const url = await captureRedirect(() =>
      setBookingStatus(formDataOf({ ...BOOKING, status: "out" })),
    );

    expect(mock.argFor("bookings", "update")).toEqual({ status: "out" });
    // Scoped by the status it read, so a concurrent move matches nothing.
    const updateChain = mock.chainsFor("bookings")[1] ?? [];
    expect(
      updateChain
        .filter((call) => call.method === "eq")
        .map((call) => call.args),
    ).toEqual([
      ["id", BOOKING_ID],
      ["company_id", COMPANY_ID],
      ["status", "confirmed"],
    ]);
    expect(redirectParams(url).get("ok")).toBe("Marked out.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("reports a booking that is no longer there", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      setBookingStatus(formDataOf({ ...BOOKING, status: "confirmed" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That booking is no longer here.",
    );
  });
});

describe("deleteBooking", () => {
  it("does not let the desk delete a booking", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      deleteBooking(formDataOf(BOOKING)),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("deletes only inside the workspace", async () => {
    const mock = setup("manager");

    const url = await captureRedirect(() =>
      deleteBooking(formDataOf(BOOKING)),
    );

    expect(mock.methodsFor("bookings")).toContain("delete");
    expect(mock.argsFor("bookings", "eq")).toEqual([
      ["id", BOOKING_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/bookings");
    expect(redirectParams(url).get("ok")).toBe("Booking deleted.");
  });
});

describe("addLineItem", () => {
  const LINE = {
    slug: "acme",
    booking_id: BOOKING_ID,
    reference: "BK-7F3K2Q",
    product_id: "22222222-2222-4222-8222-222222222222",
    quantity: "2",
    unit_price: "45.00",
  };

  it("scopes the line to the workspace and the booking", async () => {
    const mock = setup();

    const url = await captureRedirect(() => addLineItem(formDataOf(LINE)));

    expect(mock.argFor("booking_line_items", "insert")).toEqual({
      company_id: COMPANY_ID,
      booking_id: BOOKING_ID,
      product_id: LINE.product_id,
      asset_id: null,
      component_id: null,
      quantity: 2,
      unit_price_cents: 4500,
    });
    // No window: the trigger copies it from the booking.
    expect(mock.argFor("booking_line_items", "insert")).not.toHaveProperty(
      "starts_on",
    );
    expect(redirectPath(url)).toBe("/acme/bookings/BK-7F3K2Q");
    expect(redirectParams(url).get("ok")).toBe("Line added.");
  });

  it("explains an exclusion violation as a date clash", async () => {
    setup("staff", {
      handlers: {
        booking_line_items: () => ({
          data: null,
          error: { message: "conflicting key value", code: "23P01" },
        }),
      },
    });

    const url = await captureRedirect(() => addLineItem(formDataOf(LINE)));

    expect(redirectParams(url).get("error")).toBe(
      "That unit is already out on those dates.",
    );
  });

  it("refuses a quantity that is not a count", async () => {
    setup();

    const url = await captureRedirect(() =>
      addLineItem(formDataOf({ ...LINE, quantity: "0" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Choose a quantity between 1 and 99.",
    );
  });
});

describe("updateLineItem", () => {
  it("updates only inside the workspace", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      updateLineItem(
        formDataOf({
          ...BOOKING,
          line_item_id: LINE_ITEM_ID,
          quantity: "3",
          unit_price: "20",
        }),
      ),
    );

    expect(mock.argFor("booking_line_items", "update")).toEqual({
      product_id: null,
      asset_id: null,
      component_id: null,
      quantity: 3,
      unit_price_cents: 2000,
    });
    expect(mock.argsFor("booking_line_items", "eq")).toEqual([
      ["id", LINE_ITEM_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectParams(url).get("ok")).toBe("Line saved.");
  });

  it("asks for a line first", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateLineItem(formDataOf({ ...BOOKING, quantity: "1" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a line first.");
  });
});

describe("removeLineItem", () => {
  it("deletes only inside the workspace", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      removeLineItem(formDataOf({ ...BOOKING, line_item_id: LINE_ITEM_ID })),
    );

    expect(mock.methodsFor("booking_line_items")).toContain("delete");
    expect(mock.argsFor("booking_line_items", "eq")).toEqual([
      ["id", LINE_ITEM_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectParams(url).get("ok")).toBe("Line removed.");
  });
});

describe("assignAsset", () => {
  /** The line being allocated, as it comes back from the read. */
  function line(assetId: string | null): TableHandler {
    return () => ({
      data: {
        id: LINE_ITEM_ID,
        asset_id: assetId,
        starts_on: "2026-03-04",
        ends_on: "2026-03-08",
      },
      error: null,
    });
  }

  const ASSIGN = {
    slug: "acme",
    booking_id: BOOKING_ID,
    reference: "BK-7F3K2Q",
    line_item_id: LINE_ITEM_ID,
    asset_id: ASSET_ID,
  };

  it("asks the advisory check with the booking's own window", async () => {
    const mock = setup("staff", {
      handlers: { booking_line_items: line(null) },
      rpc: { check_asset_availability: () => ({ data: 0, error: null }) },
    });

    await captureRedirect(() => assignAsset(formDataOf(ASSIGN)));

    expect(mock.rpcCalls).toEqual([
      {
        method: "check_asset_availability",
        args: [
          {
            target_company_id: COMPANY_ID,
            target_asset_id: ASSET_ID,
            from_date: "2026-03-04",
            to_date: "2026-03-08",
          },
        ],
      },
    ]);
  });

  it("refuses a unit the check says is already out", async () => {
    const mock = setup("staff", {
      handlers: { booking_line_items: line(null) },
      rpc: { check_asset_availability: () => ({ data: 1, error: null }) },
    });

    const url = await captureRedirect(() => assignAsset(formDataOf(ASSIGN)));

    expect(redirectParams(url).get("error")).toBe(
      "That unit is already out on those dates.",
    );
    // The constraint would refuse it too; the desk never gets that far.
    expect(mock.methodsFor("booking_line_items")).not.toContain("update");
  });

  it("still explains the constraint when the check was stale", async () => {
    // The check is advisory: between it and the write somebody else may have
    // taken the unit, and then `23P01` is the only answer left.
    setup("staff", {
      handlers: {
        booking_line_items: (_calls, history) =>
          history.length === 1
            ? {
                data: {
                  id: LINE_ITEM_ID,
                  asset_id: null,
                  starts_on: "2026-03-04",
                  ends_on: "2026-03-08",
                },
                error: null,
              }
            : {
                data: null,
                error: { message: "conflicting key value", code: "23P01" },
              },
      },
      rpc: { check_asset_availability: () => ({ data: 0, error: null }) },
    });

    const url = await captureRedirect(() => assignAsset(formDataOf(ASSIGN)));

    expect(redirectParams(url).get("error")).toBe(
      "That unit is already out on those dates.",
    );
  });

  it("releases a unit without asking the check", async () => {
    // Empty means "not allocated yet", which never conflicts with anything.
    const mock = setup("staff", {
      handlers: { booking_line_items: line(ASSET_ID) },
    });

    const url = await captureRedirect(() =>
      assignAsset(formDataOf({ ...ASSIGN, asset_id: "" })),
    );

    expect(mock.rpcCalls).toEqual([]);
    expect(mock.argFor("booking_line_items", "update")).toEqual({
      asset_id: null,
    });
    expect(redirectParams(url).get("ok")).toBe("Unit released.");
  });

  it("does not ask the check when the unit is already on the line", async () => {
    // The function counts the line itself, so asking would always say "busy".
    const mock = setup("staff", {
      handlers: { booking_line_items: line(ASSET_ID) },
    });

    const url = await captureRedirect(() => assignAsset(formDataOf(ASSIGN)));

    expect(mock.rpcCalls).toEqual([]);
    expect(redirectParams(url).get("ok")).toBe("Unit assigned.");
  });

  it("reports a line that is no longer there", async () => {
    setup("staff");

    const url = await captureRedirect(() => assignAsset(formDataOf(ASSIGN)));

    expect(redirectParams(url).get("error")).toBe(
      "That line is no longer here.",
    );
  });
});

describe("assignRider", () => {
  it("names a rider and clears one with an empty value", async () => {
    const mock = setup();

    await captureRedirect(() =>
      assignRider(
        formDataOf({
          ...BOOKING,
          line_item_id: LINE_ITEM_ID,
          rider_id: CUSTOMER_ID,
        }),
      ),
    );

    expect(mock.argFor("booking_line_items", "update")).toEqual({
      rider_id: CUSTOMER_ID,
    });

    const url = await captureRedirect(() =>
      assignRider(
        formDataOf({ ...BOOKING, line_item_id: LINE_ITEM_ID, rider_id: "" }),
      ),
    );

    expect(mock.argsFor("booking_line_items", "update")).toEqual([
      [{ rider_id: CUSTOMER_ID }],
      [{ rider_id: null }],
    ]);
    expect(redirectParams(url).get("ok")).toBe("Rider cleared.");
  });
});

describe("assignComponent", () => {
  it("names a part and clears one with an empty value", async () => {
    const mock = setup();

    await captureRedirect(() =>
      assignComponent(
        formDataOf({
          ...BOOKING,
          line_item_id: LINE_ITEM_ID,
          component_id: COMPONENT_ID,
        }),
      ),
    );

    expect(mock.argFor("booking_line_items", "update")).toEqual({
      component_id: COMPONENT_ID,
    });

    const url = await captureRedirect(() =>
      assignComponent(
        formDataOf({
          ...BOOKING,
          line_item_id: LINE_ITEM_ID,
          component_id: "",
        }),
      ),
    );

    expect(mock.argsFor("booking_line_items", "update")).toEqual([
      [{ component_id: COMPONENT_ID }],
      [{ component_id: null }],
    ]);
    expect(redirectParams(url).get("ok")).toBe("Part released.");
    // A part is not capacity: the exclusion constraint is on `asset_id`, so this
    // write only names one.
    expect(mock.rpcCalls).toEqual([]);
  });

  it("asks for a line first", async () => {
    setup();

    const url = await captureRedirect(() =>
      assignComponent(
        formDataOf({ ...BOOKING, component_id: COMPONENT_ID }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a line first.");
  });

  it("keeps a viewer out", async () => {
    setup("member");

    const url = await captureRedirect(() =>
      assignComponent(
        formDataOf({
          ...BOOKING,
          line_item_id: LINE_ITEM_ID,
          component_id: COMPONENT_ID,
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });
});

describe("a read-only workspace", () => {
  /** A lapsed subscription with everything else about the request valid. */
  function readOnlySetup(role: MemberRole = "staff") {
    return setup(role, { subscription: "canceled" });
  }

  it("refuses to take a booking", async () => {
    const mock = readOnlySetup();

    const url = await captureRedirect(() => createBooking(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/bookings");
    expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
    expect(mock.methodsFor("bookings")).toEqual([]);
  });

  it("closes the status moves and the lines too", async () => {
    // The paywall is not a role, so it stops the desk's own writes as well.
    const mock = readOnlySetup();

    const statusUrl = await captureRedirect(() =>
      setBookingStatus(formDataOf({ ...BOOKING, status: "confirmed" })),
    );
    const lineUrl = await captureRedirect(() =>
      addLineItem(formDataOf({ ...BOOKING, quantity: "1" })),
    );

    expect(redirectParams(statusUrl).get("error")).toBe(READ_ONLY_MESSAGE);
    expect(redirectParams(lineUrl).get("error")).toBe(READ_ONLY_MESSAGE);
    expect(mock.methodsFor("bookings")).toEqual([]);
    expect(mock.methodsFor("booking_line_items")).toEqual([]);
  });
});

