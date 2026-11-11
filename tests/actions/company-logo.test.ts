import { describe, expect, it, vi } from "vitest";

import { COMPANY_ID, companyRow } from "../helpers/fixtures";
import { captureRedirect, redirectParams } from "../helpers/redirect";
import type { TableHandler } from "../helpers/supabase";
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

const { createLogoUploadUrl, removeCompanyLogo, setCompanyLogo } = await import(
  "@/lib/actions/company"
);

/** Our own logo URLs carry the bucket, which is how a replace finds the old one. */
function publicLogoUrl(path: string) {
  return `https://example.supabase.co/storage/v1/object/public/company-logos/${path}`;
}

/** A `companies` handler that answers a read and fails only the write. */
function companyWriteFails(message: string): TableHandler {
  return (calls) =>
    calls.some((call) => call.method === "update")
      ? { data: null, error: { message } }
      : { data: companyRow(), error: null };
}

describe("createLogoUploadUrl", () => {
  it("mints a URL in the workspace's folder", async () => {
    tenantSetup(serverMock.createClient);

    const target = await createLogoUploadUrl({
      slug: "acme",
      contentType: "image/png",
      size: 1024,
    });

    expect(target.ok).toBe(true);
    if (!target.ok) return;

    expect(target.path).toMatch(
      new RegExp(`^${COMPANY_ID}/[0-9a-f-]{36}\\.png$`),
    );
    expect(target.token).toBe("test-upload-token");
    expect(target.publicUrl).toBe(
      `https://storage.test/company-logos/${target.path}`,
    );
  });

  it("lets the type pick the extension", async () => {
    tenantSetup(serverMock.createClient);

    const target = await createLogoUploadUrl({
      slug: "acme",
      contentType: "image/jpeg",
      size: 10,
    });

    expect(target.ok && target.path.endsWith(".jpg")).toBe(true);
  });

  it("refuses a type the bucket would not accept", async () => {
    tenantSetup(serverMock.createClient);

    expect(
      await createLogoUploadUrl({
        slug: "acme",
        contentType: "image/gif",
        size: 10,
      }),
    ).toEqual({ ok: false, message: "Upload a PNG, JPEG, WebP or AVIF image." });
  });

  it("refuses an empty file and one past the ceiling", async () => {
    tenantSetup(serverMock.createClient);

    expect(
      await createLogoUploadUrl({
        slug: "acme",
        contentType: "image/png",
        size: 0,
      }),
    ).toEqual({ ok: false, message: "That file is empty." });

    expect(
      await createLogoUploadUrl({
        slug: "acme",
        contentType: "image/png",
        size: 2_097_153,
      }),
    ).toEqual({ ok: false, message: "Keep logos under 2 MB." });
  });

  it("does not let a manager change the workspace mark", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      createLogoUploadUrl({
        slug: "acme",
        contentType: "image/png",
        size: 10,
      }),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });
});

describe("setCompanyLogo", () => {
  it("records the public URL and answers with it", async () => {
    const mock = tenantSetup(serverMock.createClient);

    const result = await setCompanyLogo({
      slug: "acme",
      path: `${COMPANY_ID}/abc.png`,
      contentType: "image/png",
    });

    const expected = `https://storage.test/company-logos/${COMPANY_ID}/abc.png`;
    expect(mock.argFor("companies", "update")).toEqual({ logo_url: expected });
    expect(result).toEqual({
      ok: true,
      message: "Logo updated.",
      url: expected,
    });
  });

  it("revalidates from the root, because the chooser lists every workspace", async () => {
    tenantSetup(serverMock.createClient);

    await setCompanyLogo({
      slug: "acme",
      path: `${COMPANY_ID}/abc.png`,
      contentType: "image/png",
    });

    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a path in another workspace's folder", async () => {
    const mock = tenantSetup(serverMock.createClient);

    const result = await setCompanyLogo({
      slug: "acme",
      path: "99999999-9999-4999-8999-999999999999/abc.png",
      contentType: "image/png",
    });

    expect(result.ok).toBe(false);
    expect(mock.methodsFor("companies")).not.toContain("update");
  });

  it("refuses an extension the bucket does not allow", async () => {
    tenantSetup(serverMock.createClient);

    expect(
      await setCompanyLogo({
        slug: "acme",
        path: `${COMPANY_ID}/abc.svg`,
        contentType: "image/png",
      }),
    ).toEqual({
      ok: false,
      message: "That upload does not belong to this workspace.",
    });
  });

  it("deletes the logo it replaced", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    tenantSetup(
      serverMock.createClient,
      {
        companies: () => ({
          data: companyRow({ logo_url: publicLogoUrl(`${COMPANY_ID}/old.png`) }),
          error: null,
        }),
      },
      "owner",
      { storage: { "company-logos": { remove } } },
    );

    await setCompanyLogo({
      slug: "acme",
      path: `${COMPANY_ID}/new.png`,
      contentType: "image/png",
    });

    expect(remove).toHaveBeenCalledWith([`${COMPANY_ID}/old.png`]);
  });

  it("leaves a URL it did not write alone", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    tenantSetup(
      serverMock.createClient,
      {
        companies: () => ({
          data: companyRow({ logo_url: "https://cdn.example.com/logo.png" }),
          error: null,
        }),
      },
      "owner",
      { storage: { "company-logos": { remove } } },
    );

    await setCompanyLogo({
      slug: "acme",
      path: `${COMPANY_ID}/new.png`,
      contentType: "image/png",
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it("reports a write the database refused", async () => {
    tenantSetup(serverMock.createClient, {
      companies: companyWriteFails("new row violates row-level security policy"),
    });

    expect(
      await setCompanyLogo({
        slug: "acme",
        path: `${COMPANY_ID}/abc.png`,
        contentType: "image/png",
      }),
    ).toEqual({
      ok: false,
      message: "new row violates row-level security policy",
    });
  });

  it("does not let a manager change the workspace mark", async () => {
    tenantSetup(serverMock.createClient, {}, "manager");

    const url = await captureRedirect(() =>
      setCompanyLogo({
        slug: "acme",
        path: `${COMPANY_ID}/abc.png`,
        contentType: "image/png",
      }),
    );

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });
});

describe("removeCompanyLogo", () => {
  it("clears the column and forgets the object", async () => {
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths,
      error: null,
    }));
    const mock = tenantSetup(
      serverMock.createClient,
      {
        companies: () => ({
          data: companyRow({ logo_url: publicLogoUrl(`${COMPANY_ID}/old.png`) }),
          error: null,
        }),
      },
      "owner",
      { storage: { "company-logos": { remove } } },
    );

    const result = await removeCompanyLogo({ slug: "acme" });

    expect(mock.argFor("companies", "update")).toEqual({ logo_url: null });
    expect(remove).toHaveBeenCalledWith([`${COMPANY_ID}/old.png`]);
    expect(result).toEqual({ ok: true, message: "Logo removed.", url: null });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reports a write the database refused", async () => {
    tenantSetup(serverMock.createClient, {
      companies: companyWriteFails("permission denied"),
    });

    expect(await removeCompanyLogo({ slug: "acme" })).toEqual({
      ok: false,
      message: "permission denied",
    });
  });
});

