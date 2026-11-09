import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataOf } from "../helpers/fixtures";
import { captureRedirect, redirectParams } from "../helpers/redirect";
import { tenantSetup } from "../helpers/tenant";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: cacheMock.revalidatePath,
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const { updateCompany } = await import("@/lib/actions/settings");

describe("updateCompany", () => {
  beforeEach(() => cacheMock.revalidatePath.mockReset());

  it("denies a plain member", async () => {
    tenantSetup(serverMock.createClient, {}, "member");

    const url = await captureRedirect(() =>
      updateCompany(formDataOf({ slug: "acme", name: "New Name" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("does not let a manager change the company", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      updateCompany(formDataOf({ slug: "acme", name: "New Name" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("requires a name", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      updateCompany(formDataOf({ slug: "acme", name: " A " })),
    );

    expect(redirectParams(url).get("error")).toBe("Enter a company name.");
  });

  it("updates only the name, never the slug", async () => {
    const mock = tenantSetup(serverMock.createClient);

    await captureRedirect(() =>
      updateCompany(
        formDataOf({ slug: "acme", name: "Acme Wellness", next_slug: "renamed" }),
      ),
    );

    expect(mock.argFor("companies", "update")).toEqual({
      name: "Acme Wellness",
    });
  });

  it("revalidates the whole tenant layout so the sidebar updates", async () => {
    tenantSetup(serverMock.createClient);

    await captureRedirect(() =>
      updateCompany(formDataOf({ slug: "acme", name: "Acme Wellness" })),
    );

    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});
