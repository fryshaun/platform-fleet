import { beforeEach, describe, expect, it, vi } from "vitest";

import { formDataOf } from "../helpers/fixtures";
import { captureRedirect, redirectParams, redirectPath } from "../helpers/redirect";
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

const { updateCompany, updateEnabledSections } = await import(
  "@/lib/actions/settings"
);

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

    const url = await captureRedirect(() =>
      updateCompany(
        formDataOf({ slug: "acme", name: "Acme Wellness", next_slug: "renamed" }),
      ),
    );

    // Company is the index tab, so `/settings` keeps working for every link
    // written before the settings screen was split.
    expect(redirectPath(url)).toBe("/acme/settings");
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

describe("updateEnabledSections", () => {
  /** A checkbox group submits every ticked value under the same name. */
  function sectionsForm(sections: string[]) {
    const formData = new FormData();
    formData.set("slug", "acme");
    for (const section of sections) {
      formData.append("section", section);
    }
    return formData;
  }

  it("denies a plain member", async () => {
    tenantSetup(serverMock.createClient, {}, "member");

    const url = await captureRedirect(() =>
      updateEnabledSections(sectionsForm(["products"])),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("does not let a manager switch an extension on", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      updateEnabledSections(sectionsForm(["products"])),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("writes the selection as an absolute list of known keys", async () => {
    const mock = tenantSetup(serverMock.createClient);

    await captureRedirect(() =>
      updateEnabledSections(sectionsForm(["products", "services"])),
    );

    // `services` is not a section in this build, so it is dropped rather than
    // stored as a key no policy will ever match.
    expect(mock.argFor("companies", "update")).toEqual({
      enabled_sections: ["products"],
    });
  });

  it("clears the list when nothing is ticked", async () => {
    const mock = tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() => updateEnabledSections(sectionsForm([])));

    expect(mock.argFor("companies", "update")).toEqual({ enabled_sections: [] });
    expect(redirectPath(url)).toBe("/acme/settings/extensions");
    expect(redirectParams(url).get("ok")).toBe(
      "Extensions updated. All optional extensions are off.",
    );
  });

  it("names what was switched on", async () => {
    tenantSetup(serverMock.createClient);

    const url = await captureRedirect(() =>
      updateEnabledSections(sectionsForm(["products"])),
    );

    expect(redirectParams(url).get("ok")).toBe("Extensions updated: Products.");
  });

  it("revalidates the tenant layout so the rail changes", async () => {
    tenantSetup(serverMock.createClient);

    await captureRedirect(() => updateEnabledSections(sectionsForm(["products"])));

    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});
