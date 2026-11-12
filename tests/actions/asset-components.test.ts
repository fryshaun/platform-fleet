import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";

import {
  ASSET_ID,
  COMPANY_ID,
  COMPONENT_ID,
  COMPONENT_KIND_ID,
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

const {
  createComponent,
  createComponentKind,
  deleteComponent,
  deleteComponentKind,
  removeComponent,
  updateComponent,
  updateComponentKind,
} = await import("@/lib/actions/asset-components");

/**
 * The assets section is on, the workspace is paying and the caller manages the
 * shop unless a test says otherwise; `handlers` supplies only the tables the
 * action under test reads.
 */
function setup(
  role: MemberRole = "manager",
  handlers: Record<string, TableHandler> = {},
  sections: string[] = ["assets"],
  subscription: "active" | "none" = "active",
) {
  return tenantSetup(serverMock.createClient, handlers, role, {
    sections,
    subscription,
  });
}

/** The smallest valid kind form. */
const KIND = { slug: "acme", name: "Fork" };

/** The smallest valid part form, fitted to a unit. */
const PART = {
  slug: "acme",
  current_handle: "bike-1",
  name: "Fox 36",
  fitted_on: "2026-01-02",
};

beforeEach(() => cacheMock.revalidatePath.mockReset());

describe("createComponentKind", () => {
  it("keeps the taxonomy to managers", async () => {
    // Fitting a part is the front desk's work; naming a kind is not.
    setup("staff");

    const url = await captureRedirect(() =>
      createComponentKind(formDataOf(KIND)),
    );

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", {}, []);

    const url = await captureRedirect(() =>
      createComponentKind(formDataOf(KIND)),
    );

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "That extension is not enabled for this workspace.",
    );
  });

  it("refuses while the workspace is read-only", async () => {
    setup("owner", {}, ["assets"], "none");

    const url = await captureRedirect(() =>
      createComponentKind(formDataOf(KIND)),
    );

    expect(redirectPath(url)).toBe("/acme/assets");
    expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
  });

  it("files the kind under the workspace, intervals included", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createComponentKind(
        formDataOf({
          ...KIND,
          position: "2",
          interval_days: "365",
          interval_km: "12000",
          interval_hours: "50",
        }),
      ),
    );

    expect(mock.argFor("component_kinds", "insert")).toEqual({
      company_id: COMPANY_ID,
      name: "Fork",
      handle: "fork",
      position: 2,
      interval_days: 365,
      interval_km: 12000,
      interval_hours: 50,
    });
    expect(redirectPath(url)).toBe("/acme/assets/kinds");
    expect(redirectParams(url).get("ok")).toBe("Added Fork.");
    // The rail, the fleet filter and the unit pages all read kinds.
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("answers a bad interval without writing", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createComponentKind(formDataOf({ ...KIND, interval_hours: "1.234" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Use a number with at most two decimals for the hours interval.",
    );
    expect(mock.methodsFor("component_kinds")).toEqual([]);
  });

  it("names the address rule when the database refuses a duplicate", async () => {
    setup("manager", {
      component_kinds: () => ({
        data: null,
        error: { message: "duplicate key", code: "23505" },
      }),
    });

    const url = await captureRedirect(() =>
      createComponentKind(formDataOf(KIND)),
    );

    expect(redirectParams(url).get("error")).toContain(
      "already has that address",
    );
  });
});

describe("updateComponentKind", () => {
  it("writes the row it was given, inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateComponentKind(
        formDataOf({
          ...KIND,
          kind_id: COMPONENT_KIND_ID,
          current_handle: "fork",
          interval_days: "180",
        }),
      ),
    );

    expect(mock.argFor("component_kinds", "update")).toEqual({
      name: "Fork",
      handle: "fork",
      position: 0,
      interval_days: 180,
      interval_km: null,
      interval_hours: null,
    });
    expect(mock.argsFor("component_kinds", "eq")).toEqual([
      ["id", COMPONENT_KIND_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("asks for a kind when the id is missing", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateComponentKind(formDataOf(KIND)),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a kind first.");
  });
});

describe("deleteComponentKind", () => {
  it("removes the kind and scopes the delete to the workspace", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      deleteComponentKind(
        formDataOf({ slug: "acme", kind_id: COMPONENT_KIND_ID }),
      ),
    );

    expect(mock.argsFor("component_kinds", "eq")).toEqual([
      ["id", COMPONENT_KIND_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/assets/kinds");
    expect(redirectParams(url).get("ok")).toBe("Kind deleted.");
  });
});


describe("createComponent", () => {
  it("fits a part from the front desk", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      createComponent(
        formDataOf({
          ...PART,
          serial: "FOX-36-001",
          kind_id: COMPONENT_KIND_ID,
          asset_id: ASSET_ID,
          notes: "Serviced at fitting",
        }),
      ),
    );

    expect(mock.argFor("asset_components", "insert")).toEqual({
      company_id: COMPANY_ID,
      name: "Fox 36",
      serial: "FOX-36-001",
      kind_id: COMPONENT_KIND_ID,
      asset_id: ASSET_ID,
      fitted_on: "2026-01-02",
      removed_on: null,
      notes: "Serviced at fitting",
    });
    // Back to the tab the form lives on, not the unit's overview.
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/components");
    expect(redirectParams(url).get("ok")).toBe("Added Fox 36.");
  });

  it("keeps a viewer out", async () => {
    setup("member");

    const url = await captureRedirect(() =>
      createComponent(formDataOf(PART)),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("answers a window it would have to reject later", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      createComponent(
        formDataOf({ ...PART, removed_on: "2026-01-01" }),
      ),
    );

    expect(redirectPath(url)).toBe("/acme/assets/bike-1/components");
    expect(redirectParams(url).get("error")).toContain(
      "cannot come off on or before",
    );
    expect(mock.methodsFor("asset_components")).toEqual([]);
  });

  it("falls back to the fleet when the form forgot the handle", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      createComponent(
        formDataOf({ slug: "acme", name: "Spare wheel", fitted_on: "2026-01-02" }),
      ),
    );

    expect(redirectPath(url)).toBe("/acme/assets");
    expect(mock.argFor("asset_components", "insert")).toMatchObject({
      asset_id: null,
    });
  });
});

describe("updateComponent", () => {
  it("writes the row it was given, inside the workspace", async () => {
    const mock = setup("staff");

    await captureRedirect(() =>
      updateComponent(
        formDataOf({
          ...PART,
          component_id: COMPONENT_ID,
          asset_id: ASSET_ID,
          removed_on: "2026-02-01",
        }),
      ),
    );

    expect(mock.argFor("asset_components", "update")).toEqual({
      name: "Fox 36",
      serial: null,
      kind_id: null,
      asset_id: ASSET_ID,
      fitted_on: "2026-01-02",
      removed_on: "2026-02-01",
      notes: null,
    });
    expect(mock.argsFor("asset_components", "eq")).toEqual([
      ["id", COMPONENT_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("asks for a component when the id is missing", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      updateComponent(formDataOf(PART)),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a component first.");
  });
});

describe("removeComponent", () => {
  it("dates the removal rather than deleting the row", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      removeComponent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          component_id: COMPONENT_ID,
          removed_on: "2026-02-01",
        }),
      ),
    );

    expect(mock.argFor("asset_components", "update")).toEqual({
      removed_on: "2026-02-01",
    });
    expect(mock.methodsFor("asset_components")).not.toContain("delete");
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/components");
    expect(redirectParams(url).get("ok")).toBe("Component removed.");
  });

  it("defaults to today when the worksheet is today's", async () => {
    const mock = setup("staff");

    await captureRedirect(() =>
      removeComponent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          component_id: COMPONENT_ID,
        }),
      ),
    );

    expect(mock.argFor("asset_components", "update")).toEqual({
      removed_on: new Date().toISOString().slice(0, 10),
    });
  });

  it("explains a window the database refuses", async () => {
    setup("staff", {
      asset_components: () => ({
        data: null,
        error: { message: "check violation", code: "23514" },
      }),
    });

    const url = await captureRedirect(() =>
      removeComponent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          component_id: COMPONENT_ID,
          removed_on: "2026-01-01",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toContain(
      "Correct the fitted date first",
    );
  });
});

describe("deleteComponent", () => {
  it("is manager work", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      deleteComponent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          component_id: COMPONENT_ID,
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("removes the part, scoped to the workspace", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      deleteComponent(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          component_id: COMPONENT_ID,
        }),
      ),
    );

    expect(mock.argsFor("asset_components", "eq")).toEqual([
      ["id", COMPONENT_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/components");
    expect(redirectParams(url).get("ok")).toBe("Component deleted.");
  });
});

