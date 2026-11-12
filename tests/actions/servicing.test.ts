import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";

import {
  COMPANY_ID,
  COMPONENT_ID,
  SERVICE_EVENT_ID,
  formDataOf,
} from "../helpers/fixtures";
import {
  captureRedirect,
  redirectParams,
  redirectPath,
} from "../helpers/redirect";
import type { TableHandler } from "../helpers/supabase";
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

const { createServiceEvent, deleteServiceEvent } = await import(
  "@/lib/actions/servicing"
);

/** The assets section is on, the workspace is paying, the caller is staff. */
function setup(
  role: MemberRole = "staff",
  handlers: Record<string, TableHandler> = {},
  sections: string[] = ["assets"],
  subscription: "active" | "none" = "active",
) {
  return tenantSetup(serverMock.createClient, handlers, role, {
    sections,
    subscription,
  });
}

/** The smallest valid service event. */
const SERVICE = {
  slug: "acme",
  current_handle: "bike-1",
  component_id: COMPONENT_ID,
  serviced_on: "2026-03-04",
};

beforeEach(() => cacheMock.revalidatePath.mockReset());

describe("createServiceEvent", () => {
  it("records the service from the front desk up", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createServiceEvent(formDataOf({ ...SERVICE, notes: "Oil 5w" })),
    );

    expect(mock.argFor("component_service_events", "insert")).toEqual({
      company_id: COMPANY_ID,
      component_id: COMPONENT_ID,
      serviced_on: "2026-03-04",
      notes: "Oil 5w",
    });
    // Back to the tab the form lives on.
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/service");
    expect(redirectParams(url).get("ok")).toBe(
      "Service recorded. The interval counts from this day.",
    );
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("keeps a viewer out", async () => {
    setup("member");

    const url = await captureRedirect(() =>
      createServiceEvent(formDataOf(SERVICE)),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("asks for a part", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createServiceEvent(
        formDataOf({ slug: "acme", current_handle: "bike-1", serviced_on: "2026-03-04" }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Choose the part that was serviced.",
    );
    expect(mock.methodsFor("component_service_events")).toEqual([]);
  });

  it("refuses while the workspace is read-only", async () => {
    setup("owner", {}, ["assets"], "none");

    const url = await captureRedirect(() =>
      createServiceEvent(formDataOf(SERVICE)),
    );

    expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
  });
});

describe("deleteServiceEvent", () => {
  it("is manager work", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      deleteServiceEvent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          service_event_id: SERVICE_EVENT_ID,
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("removes the service, scoped to the workspace", async () => {
    const mock = setup("manager");

    const url = await captureRedirect(() =>
      deleteServiceEvent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          service_event_id: SERVICE_EVENT_ID,
        }),
      ),
    );

    expect(mock.argsFor("component_service_events", "eq")).toEqual([
      ["id", SERVICE_EVENT_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/service");
    expect(redirectParams(url).get("ok")).toBe("Service deleted.");
  });
});
