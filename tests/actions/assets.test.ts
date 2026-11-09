import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { ASSET_ID, COMPANY_ID, formDataOf, PRODUCT_ID } from "../helpers/fixtures";
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

const { createAsset, deleteAsset, setAssetStatus, updateAsset } = await import(
  "@/lib/actions/assets"
);

/**
 * The section is on and the caller manages the fleet unless a test says
 * otherwise; `handlers` supplies only the tables the action under test reads.
 */
function setup(
  role: MemberRole = "manager",
  handlers: Record<string, TableHandler> = {},
  sections: string[] = ["assets"],
) {
  return tenantSetup(serverMock.createClient, handlers, role, { sections });
}

/** The smallest valid asset form. */
const DRAFT = {
  slug: "acme",
  name: "Bike 1",
  status: "available",
};

beforeEach(() => cacheMock.revalidatePath.mockReset());

describe("createAsset", () => {
  it("denies a viewer", async () => {
    setup("member");

    const url = await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("does not let staff add a unit", async () => {
    setup("staff");

    const url = await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", {}, []);

    const url = await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    // The switch is not a permission problem, so it answers from the dashboard
    // rather than pretending the caller lacks a role.
    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "That section is not enabled for this workspace.",
    );
  });

  it("requires a name", async () => {
    setup();

    const url = await captureRedirect(() =>
      createAsset(formDataOf({ ...DRAFT, name: "  " })),
    );

    expect(redirectPath(url)).toBe("/acme/assets");
    expect(redirectParams(url).get("error")).toContain("bike-1");
  });

  it("derives the address and scopes the row to the workspace", async () => {
    const mock = setup();

    await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    expect(mock.argFor("assets", "insert")).toEqual({
      company_id: COMPANY_ID,
      name: "Bike 1",
      handle: "bike-1",
      serial: null,
      status: "available",
      product_id: null,
      notes: null,
    });
  });

  it("refuses the section's own route names before writing", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createAsset(formDataOf({ ...DRAFT, handle: "new" })),
    );

    expect(redirectParams(url).get("error")).toContain("reserved");
    expect(mock.methodsFor("assets")).toEqual([]);
  });

  it("keeps an assigned product", async () => {
    const mock = setup();

    await captureRedirect(() =>
      createAsset(formDataOf({ ...DRAFT, product_id: PRODUCT_ID })),
    );

    expect(mock.argFor("assets", "insert")).toMatchObject({
      product_id: PRODUCT_ID,
    });
  });

  it("explains a duplicate address or serial number", async () => {
    setup("manager", {
      assets: () => ({
        data: null,
        error: { message: "duplicate key", code: "23505" },
      }),
    });

    const url = await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    expect(redirectParams(url).get("error")).toBe(
      "That address or serial number is already in use.",
    );
  });

  it("explains a product that has gone away", async () => {
    setup("manager", {
      assets: () => ({
        data: null,
        error: { message: "fk violation", code: "23503" },
      }),
    });

    const url = await captureRedirect(() =>
      createAsset(formDataOf({ ...DRAFT, product_id: PRODUCT_ID })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That product is no longer in this workspace.",
    );
  });

  it("opens the new unit and refreshes the workspace", async () => {
    setup();

    const url = await captureRedirect(() => createAsset(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/assets/bike-1");
    expect(redirectParams(url).get("ok")).toBe("Added Bike 1.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});

describe("updateAsset", () => {
  const EDIT = {
    ...DRAFT,
    asset_id: ASSET_ID,
    current_handle: "bike-1",
  };

  it("does not let staff edit the record", async () => {
    setup("staff");

    const url = await captureRedirect(() => updateAsset(formDataOf(EDIT)));

    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("asks for the unit when the form lost its id", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateAsset(formDataOf({ ...DRAFT, current_handle: "bike-1" })),
    );

    expect(redirectPath(url)).toBe("/acme/assets/bike-1");
    expect(redirectParams(url).get("error")).toBe("Choose an asset first.");
  });

  it("returns to the unit's own page when a field is wrong", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateAsset(formDataOf({ ...EDIT, status: "sold" })),
    );

    expect(redirectPath(url)).toBe("/acme/assets/bike-1");
    expect(redirectParams(url).get("error")).toBe("Choose a valid status.");
  });

  it("keeps the current address when the handle field is cleared", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateAsset(formDataOf({ ...EDIT, name: "Bike One", handle: "" })),
    );

    expect(mock.argFor("assets", "update")).toMatchObject({
      name: "Bike One",
      handle: "bike-1",
    });
  });

  it("writes only inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateAsset(
        formDataOf({
          ...EDIT,
          serial: " SN-1 ",
          notes: "Front brake rubs.",
          product_id: PRODUCT_ID,
        }),
      ),
    );

    expect(mock.argFor("assets", "update")).toEqual({
      name: "Bike 1",
      handle: "bike-1",
      serial: "SN-1",
      status: "available",
      product_id: PRODUCT_ID,
      notes: "Front brake rubs.",
    });
    expect(mock.argsFor("assets", "eq")).toEqual([
      ["id", ASSET_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("confirms the save on the unit's page", async () => {
    setup();

    const url = await captureRedirect(() => updateAsset(formDataOf(EDIT)));

    expect(redirectPath(url)).toBe("/acme/assets/bike-1");
    expect(redirectParams(url).get("ok")).toBe("Asset saved.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});

describe("setAssetStatus", () => {
  const STATUS_CHANGE = {
    slug: "acme",
    asset_id: ASSET_ID,
    current_handle: "bike-1",
    status: "maintenance",
  };

  it("lets the front desk take a unit out of action", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      setAssetStatus(formDataOf(STATUS_CHANGE)),
    );

    // The one write staff owns: it must not need the manager tier, and it must
    // not carry anything but the status.
    expect(mock.argFor("assets", "update")).toEqual({ status: "maintenance" });
    expect(redirectPath(url)).toBe("/acme/assets/bike-1");
    expect(redirectParams(url).get("ok")).toBe("Marked out of action.");
  });

  it("denies a viewer", async () => {
    setup("member");

    const url = await captureRedirect(() =>
      setAssetStatus(formDataOf(STATUS_CHANGE)),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", {}, []);

    const url = await captureRedirect(() =>
      setAssetStatus(formDataOf(STATUS_CHANGE)),
    );

    expect(redirectPath(url)).toBe("/acme/dashboard");
  });

  it("rejects a status the enum does not have", async () => {
    const mock = setup("staff");

    const url = await captureRedirect(() =>
      setAssetStatus(formDataOf({ ...STATUS_CHANGE, status: "sold" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a valid status.");
    expect(mock.methodsFor("assets")).toEqual([]);
  });

  it("asks for the unit when the form lost its id", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      setAssetStatus(formDataOf({ ...STATUS_CHANGE, asset_id: "" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose an asset first.");
  });
});

describe("deleteAsset", () => {
  const REMOVAL = {
    slug: "acme",
    asset_id: ASSET_ID,
    current_handle: "bike-1",
  };

  it("does not let staff delete a unit", async () => {
    setup("staff");

    const url = await captureRedirect(() => deleteAsset(formDataOf(REMOVAL)));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("deletes only inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() => deleteAsset(formDataOf(REMOVAL)));

    expect(mock.argsFor("assets", "eq")).toEqual([
      ["id", ASSET_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("returns to the fleet with a confirmation", async () => {
    setup();

    const url = await captureRedirect(() => deleteAsset(formDataOf(REMOVAL)));

    expect(redirectPath(url)).toBe("/acme/assets");
    expect(redirectParams(url).get("ok")).toBe("Asset deleted.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});

