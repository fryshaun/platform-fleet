import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";

import {
  ASSET_ID,
  COMPANY_ID,
  USAGE_LOG_ID,
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

const { createUsageLog, deleteUsageLog, updateUsageLog } = await import(
  "@/lib/actions/usage"
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

/** The smallest valid reading. */
const READING = {
  slug: "acme",
  current_handle: "bike-1",
  asset_id: ASSET_ID,
  logged_on: "2026-03-04",
  hours: "4.25",
  distance_km: "38",
};

beforeEach(() => cacheMock.revalidatePath.mockReset());

describe("createUsageLog", () => {
  it("logs a reading against the unit, from the front desk up", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createUsageLog(formDataOf({ ...READING, notes: "Chain waxed" })),
    );

    expect(mock.argFor("asset_usage_logs", "insert")).toEqual({
      company_id: COMPANY_ID,
      asset_id: ASSET_ID,
      logged_on: "2026-03-04",
      hours: 4.25,
      distance_km: 38,
      notes: "Chain waxed",
    });
    // Back to the tab the form lives on.
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/usage");
    expect(redirectParams(url).get("ok")).toBe("Reading logged.");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("keeps a viewer out", async () => {
    setup("member");

    const url = await captureRedirect(() =>
      createUsageLog(formDataOf(READING)),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses a reading that says nothing", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      createUsageLog(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          asset_id: ASSET_ID,
          logged_on: "2026-03-04",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "A reading needs hours, kilometres, or both.",
    );
    expect(mock.methodsFor("asset_usage_logs")).toEqual([]);
  });

  it("asks for a unit when the form forgot it", async () => {
    setup();

    const url = await captureRedirect(() =>
      createUsageLog(formDataOf({ slug: "acme", hours: "4" })),
    );

    expect(redirectPath(url)).toBe("/acme/assets");
    expect(redirectParams(url).get("error")).toBe("Choose a unit first.");
  });

  it("refuses while the workspace is read-only", async () => {
    setup("owner", {}, ["assets"], "none");

    const url = await captureRedirect(() =>
      createUsageLog(formDataOf(READING)),
    );

    expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
  });
});

describe("updateUsageLog", () => {
  it("corrects the reading, inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateUsageLog(
        formDataOf({ ...READING, usage_log_id: USAGE_LOG_ID, hours: "5" }),
      ),
    );

    expect(mock.argFor("asset_usage_logs", "update")).toEqual({
      logged_on: "2026-03-04",
      hours: 5,
      distance_km: 38,
      notes: null,
    });
    // The unit is not part of an edit: moving a reading would change two units'
    // service arithmetic, so that is a delete and a re-log.
    expect(mock.argFor("asset_usage_logs", "update")).not.toHaveProperty(
      "asset_id",
    );
    expect(mock.argsFor("asset_usage_logs", "eq")).toEqual([
      ["id", USAGE_LOG_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("asks for a reading when the id is missing", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateUsageLog(formDataOf(READING)),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a reading first.");
  });
});

describe("deleteUsageLog", () => {
  it("is manager work", async () => {
    setup("staff");

    const url = await captureRedirect(() =>
      deleteUsageLog(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          usage_log_id: USAGE_LOG_ID,
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("removes the reading, scoped to the workspace", async () => {
    const mock = setup("manager");

    const url = await captureRedirect(() =>
      deleteUsageLog(
        formDataOf({
          slug: "acme",
          current_handle: "bike-1",
          usage_log_id: USAGE_LOG_ID,
        }),
      ),
    );

    expect(mock.argsFor("asset_usage_logs", "eq")).toEqual([
      ["id", USAGE_LOG_ID],
      ["company_id", COMPANY_ID],
    ]);
    expect(redirectPath(url)).toBe("/acme/assets/bike-1/usage");
    expect(redirectParams(url).get("ok")).toBe("Reading deleted.");
  });
});
