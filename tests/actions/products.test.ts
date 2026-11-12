import { describe, expect, it, vi } from "vitest";

import type { MemberRole, SubscriptionStatus } from "@/lib/supabase/types";

import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlements";

import {
  COMPANY_ID,
  companyRow,
  formDataOf,
  productRow,
  PRODUCT_ID,
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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverMock.createClient,
}));

const {
  addMediaLink,
  addProductDate,
  createCategory,
  createMediaUploadUrl,
  createProduct,
  createVariant,
  deleteCategory,
  deleteProduct,
  recordMediaUpload,
  removeProductMedia,
  setProductStatus,
  updateCategory,
  updateInventory,
  updateProduct,
} = await import("@/lib/actions/products");

/**
 * The section is on, the workspace is paying and the caller manages the shop
 * unless a test says otherwise; `handlers` supplies only the tables the action
 * under test reads.
 */
function setup(
  role: MemberRole = "manager",
  handlers: Record<string, TableHandler> = {},
  sections: string[] = ["products"],
) {
  return tenantSetup(serverMock.createClient, handlers, role, {
    sections,
    subscription: "active",
  });
}

/** The same setup, for a workspace started in a currency other than dollars. */
function setupIn(currency: string, role: MemberRole = "manager") {
  return tenantSetup(
    serverMock.createClient,
    {
      companies: () => ({
        data: companyRow({
          enabled_sections: ["products"],
          currency,
          subscription_status: "active",
        }),
        error: null,
      }),
    },
    role,
  );
}

/** The smallest valid product form. */
const DRAFT = {
  slug: "acme",
  title: "Espresso Beans",
  price: "18.00",
  status: "draft",
  kind: "item",
  currency: "usd",
};

describe("createProduct", () => {
  it("denies a viewer", async () => {
    setup("member");

    const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    expect(redirectParams(url).get("error")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", {}, []);

    const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    // The switch is not a permission problem, so it answers from the dashboard
    // rather than pretending the caller lacks a role.
    expect(redirectPath(url)).toBe("/acme/dashboard");
    expect(redirectParams(url).get("error")).toBe(
      "That extension is not enabled for this workspace.",
    );
  });

  it("requires a name", async () => {
    setup();

    const url = await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, title: " A " })),
    );

    expect(redirectPath(url)).toBe("/acme/products/new");
    expect(redirectParams(url).get("error")).toBe("Enter a product name.");
  });

  it("returns a failed panel submit to the index the panel lives on", async () => {
    setup();

    const url = await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, title: " A ", surface: "panel" })),
    );

    // Both surfaces post the same fields; only the way back differs, so a
    // mistyped name in the slideout does not close it and change the page.
    expect(redirectPath(url)).toBe("/acme/products");
    expect(redirectParams(url).get("error")).toBe("Enter a product name.");
  });

  it("derives the address and stores the price in minor units", async () => {
    const mock = setup();

    await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, price: "18.5" })),
    );

    expect(mock.argFor("products", "insert")).toEqual({
      title: "Espresso Beans",
      handle: "espresso-beans",
      description: null,
      status: "draft",
      kind: "item",
      category_id: null,
      sku: null,
      supplier: null,
      price_cents: 1850,
      currency: "usd",
      compare_at_price_cents: null,
      company_id: COMPANY_ID,
      track_inventory: true,
      inventory_quantity: 0,
    });
  });

  it("falls back to the workspace's default currency", async () => {
    const mock = setupIn("eur");

    // A create form always posts the select, but a client that drops the field
    // must not quietly write dollars into a euro workspace.
    await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, currency: "" })),
    );

    expect(mock.argFor("products", "insert")).toMatchObject({ currency: "eur" });
  });

  it("prefers the currency the form sends to the workspace default", async () => {
    const mock = setupIn("eur");

    await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, currency: "gbp" })),
    );

    expect(mock.argFor("products", "insert")).toMatchObject({ currency: "gbp" });
  });

  it("falls back to dollars when the workspace default is not one this build offers", async () => {
    const mock = setupIn("jpy");

    // The column accepts any three-letter code; the app is the allowlist, and a
    // workspace set by hand to something the form cannot show still creates
    // products rather than failing every submit.
    await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, currency: "" })),
    );

    expect(mock.argFor("products", "insert")).toMatchObject({ currency: "usd" });
  });

  it("keeps an address the form supplies", async () => {
    const mock = setup();

    await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, handle: "beans-1kg" })),
    );

    expect(mock.argFor("products", "insert")).toMatchObject({
      handle: "beans-1kg",
    });
  });

  it("rejects an amount it cannot store exactly", async () => {
    setup();

    const url = await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, price: "18.999" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Enter a price, for example 24.99.",
    );
  });

  it("rejects a status outside the enum", async () => {
    setup();

    const url = await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, status: "published" })),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a product status.");
  });

  it("refuses an address the section routes already use", async () => {
    setup();

    const url = await captureRedirect(() =>
      createProduct(formDataOf({ ...DRAFT, handle: "categories" })),
    );

    expect(redirectParams(url).get("error")).toMatch(/reserved/);
  });

  it("maps a duplicate address onto something readable", async () => {
    setup("manager", {
      products: () => ({
        data: null,
        error: { message: "duplicate key value violates unique constraint", code: "23505" },
      }),
    });

    const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/products/new");
    expect(redirectParams(url).get("error")).toBe(
      "That product address is already in use.",
    );
  });

  it("sends the author to the product it just created", async () => {
    const mock = setup();

    const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    expect(redirectPath(url)).toBe("/acme/products/espresso-beans");
    expect(redirectParams(url).get("ok")).toBe("Added Espresso Beans.");
    expect(mock.methodsFor("products")).toContain("insert");
  });

  it("refreshes the workspace so the new product is in the rail's section", async () => {
    const { revalidatePath } = await import("next/cache");
    setup();

    await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    // `app/[tenant]/layout.tsx` is the nearest layout, so this is the call that
    // covers the list, the detail page and the categories page at once.
    expect(revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });
});

describe("updateProduct", () => {
  const edit = {
    ...DRAFT,
    product_id: PRODUCT_ID,
    current_handle: "espresso-beans",
  };

  it("scopes the update to the product and the workspace", async () => {
    const mock = setup();

    await captureRedirect(() => updateProduct(formDataOf(edit)));

    // The id comes from the form, so the tenant filter is what stops one
    // workspace editing another's row.
    expect(mock.argsFor("products", "eq")).toEqual([
      ["id", PRODUCT_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("falls back to the workspace's default currency when the field is dropped", async () => {
    const mock = setupIn("nzd");

    // The edit form always posts the product's own currency, so this only
    // happens to a hand-written request — and a New Zealand workspace's default
    // is a better guess than dollars.
    await captureRedirect(() =>
      updateProduct(formDataOf({ ...edit, currency: "" })),
    );

    expect(mock.argFor("products", "update")).toMatchObject({
      currency: "nzd",
    });
  });

  it("requires a product id", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateProduct(formDataOf({ ...edit, product_id: "" })),
    );

    expect(redirectPath(url)).toBe("/acme/products");
    expect(redirectParams(url).get("error")).toBe("Choose a product first.");
  });

  it("returns to the product page when a field is wrong", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateProduct(formDataOf({ ...edit, title: "" })),
    );

    expect(redirectPath(url)).toBe("/acme/products/espresso-beans");
    expect(redirectParams(url).get("error")).toBe("Enter a product name.");
  });

  it("confirms the save on the (possibly moved) address", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateProduct(formDataOf({ ...edit, handle: "beans" })),
    );

    expect(redirectPath(url)).toBe("/acme/products/beans");
    expect(redirectParams(url).get("ok")).toBe("Product saved.");
  });

  it("keeps the current address when the field is cleared", async () => {
    const mock = setup();

    // A cleared field should not silently move the URL, so the hidden handle is
    // the fallback before the title is derived from.
    const url = await captureRedirect(() =>
      updateProduct(formDataOf({ ...edit, handle: "", title: "Espresso Beans 1kg" })),
    );

    expect(mock.argFor("products", "update")).toMatchObject({
      handle: "espresso-beans",
      title: "Espresso Beans 1kg",
    });
    expect(redirectPath(url)).toBe("/acme/products/espresso-beans");
  });
});

describe("setProductStatus", () => {
  it("refuses a status outside the enum", async () => {
    setup();

    const url = await captureRedirect(() =>
      setProductStatus(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          status: "deleted",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe("Choose a valid status.");
  });

  it("writes the status it was given", async () => {
    const mock = setup();

    const url = await captureRedirect(() =>
      setProductStatus(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          status: "archived",
          current_handle: "espresso-beans",
        }),
      ),
    );

    expect(mock.argFor("products", "update")).toEqual({ status: "archived" });
    expect(redirectPath(url)).toBe("/acme/products/espresso-beans");
    expect(redirectParams(url).get("ok")).toBe("Marked archived.");
  });
});

describe("deleteProduct", () => {
  it("deletes only inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      deleteProduct(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          current_handle: "espresso-beans",
        }),
      ),
    );

    expect(mock.argsFor("products", "eq")).toEqual([
      ["id", PRODUCT_ID],
      ["company_id", COMPANY_ID],
    ]);
  });

  it("sends the author back to the catalogue", async () => {
    setup();

    const url = await captureRedirect(() =>
      deleteProduct(formDataOf({ slug: "acme", product_id: PRODUCT_ID })),
    );

    expect(redirectPath(url)).toBe("/acme/products");
    expect(redirectParams(url).get("ok")).toBe("Product deleted.");
  });
});

describe("createVariant", () => {
  const variant = {
    slug: "acme",
    parent_id: PRODUCT_ID,
    current_handle: "espresso-beans",
    title: "Large",
  };

  it("inherits the parent's category, status, kind and currency", async () => {
    const mock = setup("manager", {
      products: () => ({
        data: productRow({
          category_id: "category-1",
          status: "active",
          kind: "dated",
          currency: "eur",
          price_cents: 2500,
        }),
        error: null,
      }),
    });

    await captureRedirect(() => createVariant(formDataOf(variant)));

    expect(mock.argFor("products", "insert")).toMatchObject({
      parent_id: PRODUCT_ID,
      category_id: "category-1",
      status: "active",
      kind: "dated",
      currency: "eur",
      price_cents: 2500,
      handle: "espresso-beans-large",
      company_id: COMPANY_ID,
    });
  });

  it("refuses a variant of a variant", async () => {
    setup("manager", {
      products: () => ({
        data: productRow({ parent_id: "another-parent" }),
        error: null,
      }),
    });

    const url = await captureRedirect(() => createVariant(formDataOf(variant)));

    expect(redirectParams(url).get("error")).toBe(
      "A variant cannot have variants of its own.",
    );
  });

  it("refuses a parent that is not in this workspace", async () => {
    setup("manager", { products: () => ({ data: null, error: null }) });

    const url = await captureRedirect(() => createVariant(formDataOf(variant)));

    expect(redirectParams(url).get("error")).toBe("That product was not found.");
  });
});

describe("updateInventory", () => {
  it("rejects a negative count", async () => {
    setup();

    const url = await captureRedirect(() =>
      updateInventory(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          inventory_quantity: "-2",
          track_inventory: "on",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Enter a stock count of zero or more.",
    );
  });

  it("keeps the number when counting is switched off", async () => {
    const mock = setup();

    // An unchecked checkbox submits nothing at all.
    await captureRedirect(() =>
      updateInventory(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          inventory_quantity: "4",
        }),
      ),
    );

    expect(mock.argFor("products", "update")).toEqual({
      track_inventory: false,
      inventory_quantity: 4,
    });
  });

  it("stores an empty count as not counted", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateInventory(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          inventory_quantity: "",
          track_inventory: "on",
        }),
      ),
    );

    expect(mock.argFor("products", "update")).toEqual({
      track_inventory: true,
      inventory_quantity: null,
    });
  });
});

describe("addProductDate", () => {
  const date = {
    slug: "acme",
    product_id: PRODUCT_ID,
    current_handle: "espresso-beans",
    starts_on: "2026-03-04",
    inventory_quantity: "8",
  };

  it("refuses a window that runs backwards", async () => {
    setup();

    const url = await captureRedirect(() =>
      addProductDate(
        formDataOf({ ...date, starts_on: "2026-03-08", ends_on: "2026-03-04" }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe(
      "The end date must be on or after the start date.",
    );
  });

  it("treats an empty end date as a single day", async () => {
    const mock = setup();

    await captureRedirect(() => addProductDate(formDataOf(date)));

    expect(mock.argFor("product_dates", "insert")).toMatchObject({
      starts_on: "2026-03-04",
      ends_on: "2026-03-04",
      inventory_quantity: 8,
      // No price override, so the product price applies.
      price_cents: null,
    });
  });

  it("keeps the price override it was given", async () => {
    const mock = setup();

    await captureRedirect(() =>
      addProductDate(formDataOf({ ...date, price: "12.50" })),
    );

    expect(mock.argFor("product_dates", "insert")).toMatchObject({
      price_cents: 1250,
    });
  });

  it("requires a stock number", async () => {
    setup();

    const url = await captureRedirect(() =>
      addProductDate(formDataOf({ ...date, inventory_quantity: "" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "Enter how many are available on these dates.",
    );
  });
});

describe("createCategory", () => {
  it("derives the address from the name", async () => {
    const mock = setup();

    await captureRedirect(() =>
      createCategory(
        formDataOf({ slug: "acme", name: "Hot Drinks", position: "2" }),
      ),
    );

    expect(mock.argFor("product_categories", "insert")).toEqual({
      company_id: COMPANY_ID,
      name: "Hot Drinks",
      handle: "hot-drinks",
      description: null,
      position: 2,
    });
  });

  it("needs a name", async () => {
    setup();

    const url = await captureRedirect(() =>
      createCategory(formDataOf({ slug: "acme", name: "" })),
    );

    expect(redirectPath(url)).toBe("/acme/products/categories");
    expect(redirectParams(url).get("error")).toBe("Enter a category name.");
  });

  it("maps a duplicate address", async () => {
    setup("manager", {
      product_categories: () => ({
        data: null,
        error: { message: "duplicate key value", code: "23505" },
      }),
    });

    const url = await captureRedirect(() =>
      createCategory(formDataOf({ slug: "acme", name: "Hot Drinks" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That category address is already in use.",
    );
  });
});

describe("updateCategory", () => {
  it("keeps the address when only the name changed", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateCategory(
        formDataOf({
          slug: "acme",
          category_id: "category-1",
          name: "Warm Drinks",
          current_handle: "hot-drinks",
          position: "1",
        }),
      ),
    );

    expect(mock.argFor("product_categories", "update")).toMatchObject({
      name: "Warm Drinks",
      handle: "hot-drinks",
      position: 1,
    });
  });

  it("scopes the update to the category and the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      updateCategory(
        formDataOf({
          slug: "acme",
          category_id: "category-1",
          name: "Warm Drinks",
        }),
      ),
    );

    expect(mock.argsFor("product_categories", "eq")).toEqual([
      ["id", "category-1"],
      ["company_id", COMPANY_ID],
    ]);
  });
});

describe("deleteCategory", () => {
  it("deletes only inside the workspace", async () => {
    const mock = setup();

    await captureRedirect(() =>
      deleteCategory(formDataOf({ slug: "acme", category_id: "category-1" })),
    );

    expect(mock.argsFor("product_categories", "eq")).toEqual([
      ["id", "category-1"],
      ["company_id", COMPANY_ID],
    ]);
  });
});

describe("createMediaUploadUrl", () => {
  const upload = {
    slug: "acme",
    productId: PRODUCT_ID,
    contentType: "image/png",
    size: 1024,
  };

  it("mints a token inside the workspace's product folder", async () => {
    setup("manager", { products: () => ({ data: productRow(), error: null }) });

    const result = await createMediaUploadUrl(upload);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // `<company>/<product>/<uuid>.<ext>` — the shape the storage policies parse.
    expect(result.path.startsWith(`${COMPANY_ID}/${PRODUCT_ID}/`)).toBe(true);
    expect(result.path.endsWith(".png")).toBe(true);
    expect(result.token).toBe("test-upload-token");
  });

  it("refuses a type the bucket does not accept", async () => {
    setup();

    const result = await createMediaUploadUrl({
      ...upload,
      contentType: "application/pdf",
    });

    expect(result).toEqual({
      ok: false,
      message: "Upload a PNG, JPEG, WebP, AVIF, MP4 or WebM file.",
    });
  });

  it("refuses a file above the bucket ceiling", async () => {
    setup();

    const result = await createMediaUploadUrl({ ...upload, size: 52_428_801 });

    expect(result).toEqual({ ok: false, message: "Keep files under 50 MB." });
  });

  it("refuses a product that is not in this workspace", async () => {
    setup("manager", { products: () => ({ data: null, error: null }) });

    const result = await createMediaUploadUrl(upload);

    expect(result).toEqual({ ok: false, message: "That product was not found." });
  });

  it("answers a viewer instead of throwing a redirect", async () => {
    // The uploader awaits this call, so a refusal has to be a value.
    setup("member");

    const result = await createMediaUploadUrl(upload);

    expect(result).toEqual({
      ok: false,
      message: "You do not have permission to do that.",
    });
  });

  it("refuses while the section is switched off", async () => {
    setup("owner", {}, []);

    const result = await createMediaUploadUrl(upload);

    expect(result).toEqual({
      ok: false,
      message: "That extension is not enabled for this workspace.",
    });
  });
});

describe("recordMediaUpload", () => {
  const storagePath = `${COMPANY_ID}/${PRODUCT_ID}/one.png`;

  it("records the row for a path this workspace could have issued", async () => {
    const mock = setup();

    const result = await recordMediaUpload({
      slug: "acme",
      productId: PRODUCT_ID,
      path: storagePath,
      contentType: "image/png",
    });

    expect(result).toEqual({ ok: true, message: "Added to the gallery." });
    expect(mock.argFor("product_media", "insert")).toEqual({
      company_id: COMPANY_ID,
      product_id: PRODUCT_ID,
      kind: "image",
      storage_path: storagePath,
    });
  });

  it("refuses a path for another product", async () => {
    setup();

    const result = await recordMediaUpload({
      slug: "acme",
      productId: PRODUCT_ID,
      path: `${COMPANY_ID}/other-product/one.png`,
      contentType: "image/png",
    });

    expect(result).toEqual({
      ok: false,
      message: "That upload path is not valid.",
    });
  });

  it("refuses a path that tries to climb out of the folder", async () => {
    setup();

    const result = await recordMediaUpload({
      slug: "acme",
      productId: PRODUCT_ID,
      path: `${COMPANY_ID}/${PRODUCT_ID}/../../secret.png`,
      contentType: "image/png",
    });

    expect(result).toEqual({
      ok: false,
      message: "That upload path is not valid.",
    });
  });

  it("answers a viewer instead of throwing a redirect", async () => {
    setup("member");

    const result = await recordMediaUpload({
      slug: "acme",
      productId: PRODUCT_ID,
      path: storagePath,
      contentType: "image/png",
    });

    expect(result).toEqual({
      ok: false,
      message: "You do not have permission to do that.",
    });
  });
});

describe("addMediaLink", () => {
  it("rejects a link that is not http(s)", async () => {
    setup();

    const url = await captureRedirect(() =>
      addMediaLink(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          url: "javascript:alert(1)",
        }),
      ),
    );

    expect(redirectParams(url).get("error")).toBe("Enter a full http(s) link.");
  });

  it("stores the link with its kind", async () => {
    const mock = setup();

    await captureRedirect(() =>
      addMediaLink(
        formDataOf({
          slug: "acme",
          product_id: PRODUCT_ID,
          url: "https://cdn.example.com/clip.mp4",
          kind: "video",
          current_handle: "espresso-beans",
        }),
      ),
    );

    expect(mock.argFor("product_media", "insert")).toEqual({
      company_id: COMPANY_ID,
      product_id: PRODUCT_ID,
      kind: "video",
      url: "https://cdn.example.com/clip.mp4",
      alt: null,
    });
  });
});

describe("removeProductMedia", () => {
  it("refuses an item that is not in this workspace", async () => {
    setup("manager", { product_media: () => ({ data: null, error: null }) });

    const url = await captureRedirect(() =>
      removeProductMedia(formDataOf({ slug: "acme", media_id: "media-1" })),
    );

    expect(redirectParams(url).get("error")).toBe(
      "That gallery item was not found.",
    );
  });

  it("removes the row and reports success", async () => {
    const mock = setup("manager", {
      product_media: () => ({
        data: {
          id: "media-1",
          storage_path: `${COMPANY_ID}/${PRODUCT_ID}/one.png`,
        },
        error: null,
      }),
    });

    const url = await captureRedirect(() =>
      removeProductMedia(formDataOf({ slug: "acme", media_id: "media-1" })),
    );

    expect(mock.methodsFor("product_media")).toContain("delete");
    expect(redirectParams(url).get("ok")).toBe("Removed from the gallery.");
  });
});


describe("a read-only workspace", () => {
  /** A lapsed subscription with everything else about the request valid. */
  function readOnlySetup(status: SubscriptionStatus = "canceled") {
    return tenantSetup(serverMock.createClient, {}, "owner", {
      sections: ["products"],
      subscription: status,
    });
  }

  it.each(["none", "canceled", "unpaid"] as const)(
    "refuses a product write when the status is %s",
    async (status) => {
      const mock = readOnlySetup(status);

      const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

      expect(redirectPath(url)).toBe("/acme/products");
      expect(redirectParams(url).get("error")).toBe(READ_ONLY_MESSAGE);
      // Nothing reached the table. RLS would drop an update without a word, so
      // the guard has to be what answers — this is the assertion that notices if
      // the order of the checks ever changes.
      expect(mock.methodsFor("products")).toEqual([]);
    },
  );

  it("keeps dunning writable, because Stripe can still recover it", async () => {
    const mock = readOnlySetup("past_due");

    const url = await captureRedirect(() => createProduct(formDataOf(DRAFT)));

    expect(mock.methodsFor("products")).toContain("insert");
    expect(redirectParams(url).get("ok")).toBe("Added Espresso Beans.");
  });

  it("answers the gallery uploader inline instead of redirecting", async () => {
    // These two are awaited by the client uploader, so they cannot redirect: a
    // refusal is a message, not a page.
    readOnlySetup();

    await expect(
      createMediaUploadUrl({
        slug: "acme",
        productId: PRODUCT_ID,
        contentType: "image/png",
        size: 1024,
      }),
    ).resolves.toEqual({ ok: false, message: READ_ONLY_MESSAGE });
  });

  it("refuses to record an upload that already landed in the bucket", async () => {
    const mock = readOnlySetup();

    await expect(
      recordMediaUpload({
        slug: "acme",
        productId: PRODUCT_ID,
        path: `${COMPANY_ID}/${PRODUCT_ID}/photo.png`,
        contentType: "image/png",
      }),
    ).resolves.toEqual({ ok: false, message: READ_ONLY_MESSAGE });

    expect(mock.methodsFor("product_media")).toEqual([]);
  });
});
