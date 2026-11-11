"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  readInt,
  redirectWith,
  requireManager,
  requireSection,
} from "@/lib/actions/support";
import { isSectionEnabled } from "@/lib/features";
import {
  categoryHandleProblem,
  dateRangeProblem,
  deriveHandle,
  isProductCurrency,
  isProductKind,
  isProductStatus,
  mediaTypeFor,
  parsePriceCents,
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_MEDIA_MAX_BYTES,
  PRODUCT_STATUS_LABELS,
  productHandleProblem,
  productMediaPath,
} from "@/lib/products";
import { canManage } from "@/lib/roles";
import type { ProductKind, ProductStatus } from "@/lib/supabase/types";

/**
 * Writes for the products section.
 *
 * Every action here does the same four things, in this order: resolve the
 * tenant, check the manager tier, check that the section is switched on, then
 * write. The database repeats all three checks through RLS — this is what turns
 * a refused write into a sentence a person can read.
 *
 * Results follow the pattern the rest of the app uses: a redirect back to the
 * page that owns the form with `?ok=` or `?error=`. The two gallery-upload
 * actions are the exception, because a Client Component awaits them and needs
 * the answer inline.
 */

/** A product row, as the forms submit it. */
type ProductDraft = {
  title: string;
  handle: string;
  description: string | null;
  status: ProductStatus;
  kind: ProductKind;
  category_id: string | null;
  sku: string | null;
  supplier: string | null;
  price_cents: number;
  currency: string;
  compare_at_price_cents: number | null;
};

/**
 * Refreshes everything under the workspace.
 *
 * The nearest layout is `app/[tenant]/layout.tsx`, so invalidating it covers the
 * list, the detail page — including a path that just changed because the handle
 * did — and the categories page in one call. It is the same call
 * `updateCompany` makes for the same reason.
 */
function revalidateProducts(slug: string) {
  revalidatePath(`/${slug}`, "layout");
}

/** Maps a Postgres error onto something worth showing in a form. */
function writeErrorMessage(
  error: { message: string; code?: string },
  duplicate: string,
): string {
  if (error.code === "23505") return duplicate;
  if (error.code === "23503") {
    return "That category or product is no longer in this workspace.";
  }
  if (error.code === "23514") {
    return "Some of those values are out of range.";
  }
  return error.message;
}

/** The page a product form should return to, given the hidden handle field. */
function productPath(formData: FormData): string {
  const handle = readField(formData, "current_handle");
  return handle ? `products/${handle}` : "products";
}

/**
 * Where a failed create returns to.
 *
 * The same fields are posted from two places: the slideout on the index and the
 * standalone `/products/new` page. A hidden `surface=panel` says which one, so
 * the error lands back in the form the author was using instead of closing the
 * panel and handing them a different page. A flag rather than a path, so nothing
 * the browser sends can steer the redirect.
 */
function createErrorPath(formData: FormData): string {
  return readField(formData, "surface") === "panel"
    ? "products"
    : "products/new";
}

/** Reads and validates the fields shared by create and update. */
function readProductDraft(
  formData: FormData,
): { draft: ProductDraft } | { error: string } {
  const title = readField(formData, "title");
  if (title.length < 2) {
    return { error: "Enter a product name." };
  }

  // The address is derived from the name unless the form supplies one, the same
  // rule the onboarding form uses for company slugs. An edit whose field was
  // cleared keeps the current address rather than silently moving the URL.
  const handle =
    readField(formData, "handle") ||
    readField(formData, "current_handle") ||
    deriveHandle(title);
  const handleProblem = productHandleProblem(handle);
  if (handleProblem) {
    return { error: handleProblem };
  }

  const priceField = readField(formData, "price");
  const price = priceField === "" ? 0 : parsePriceCents(priceField);
  if (price === null) {
    return { error: "Enter a price, for example 24.99." };
  }

  const compareField = readField(formData, "compare_at_price");
  const compareAt = compareField === "" ? null : parsePriceCents(compareField);
  if (compareField !== "" && compareAt === null) {
    return {
      error: "Enter the compare-at price as an amount, or leave it empty.",
    };
  }

  const status = readField(formData, "status");
  if (!isProductStatus(status)) {
    return { error: "Choose a product status." };
  }

  const kind = readField(formData, "kind");
  if (!isProductKind(kind)) {
    return { error: "Choose how this product is stocked." };
  }

  const currency = readField(formData, "currency") || "usd";
  if (!isProductCurrency(currency)) {
    return { error: "Choose a currency from the list." };
  }

  const sku = readField(formData, "sku");
  if (sku.length > 64) {
    return { error: "Keep the SKU under 64 characters." };
  }

  const supplier = readField(formData, "supplier");
  if (supplier.length > 120) {
    return { error: "Keep the supplier under 120 characters." };
  }

  return {
    draft: {
      title,
      handle,
      description: readField(formData, "description") || null,
      status,
      kind,
      category_id: readField(formData, "category_id") || null,
      sku: sku || null,
      supplier: supplier || null,
      price_cents: price,
      currency,
      compare_at_price_cents: compareAt,
    },
  };
}

export async function createProduct(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const parsed = readProductDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, createErrorPath(formData), { error: parsed.error });
  }

  const { error } = await context.supabase.from("products").insert({
    ...parsed.draft,
    company_id: context.company.id,
    // Stock is edited on the product page; a new product starts counted at zero
    // so "Out of stock" is the literal truth rather than "not counted".
    track_inventory: true,
    inventory_quantity: 0,
  });

  if (error) {
    redirectWith(slug, createErrorPath(formData), {
      error: writeErrorMessage(error, "That product address is already in use."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, `products/${parsed.draft.handle}`, {
    ok: `Added ${parsed.draft.title}.`,
  });
}

export async function updateProduct(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, "products", { error: "Choose a product first." });
  }

  const back = productPath(formData);
  const parsed = readProductDraft(formData);
  if ("error" in parsed) {
    redirectWith(slug, back, { error: parsed.error });
  }

  const { error } = await context.supabase
    .from("products")
    .update(parsed.draft)
    .eq("id", productId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, {
      error: writeErrorMessage(error, "That product address is already in use."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, `products/${parsed.draft.handle}`, { ok: "Product saved." });
}

/** Publishes, unpublishes or archives a product. */
export async function setProductStatus(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, back, { error: "Choose a product first." });
  }

  const status = readField(formData, "status");
  if (!isProductStatus(status)) {
    redirectWith(slug, back, { error: "Choose a valid status." });
  }

  const { error } = await context.supabase
    .from("products")
    .update({ status })
    .eq("id", productId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, {
    ok: `Marked ${PRODUCT_STATUS_LABELS[status].toLowerCase()}.`,
  });
}

/** Deletes a product, and with it its variants, gallery rows and dates. */
export async function deleteProduct(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, "products", { error: "Choose a product first." });
  }

  const back = productPath(formData);
  const { error } = await context.supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateProducts(slug);
  redirectWith(slug, "products", { ok: "Product deleted." });
}

/**
 * Adds a variant under an existing product.
 *
 * A variant is an ordinary product row with `parent_id` set, so everything else
 * — price, SKU, stock, gallery — works on it unchanged. Category, status, kind
 * and currency are inherited from the parent: a variant of a dated product is a
 * dated product. The database trigger refuses a second level.
 */
export async function createVariant(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const parentId = readField(formData, "parent_id");
  if (!parentId) {
    redirectWith(slug, back, {
      error: "Choose the product this variant belongs to.",
    });
  }

  const { data: parent } = await context.supabase
    .from("products")
    .select(
      "id, handle, status, kind, category_id, currency, price_cents, parent_id",
    )
    .eq("id", parentId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!parent) {
    redirectWith(slug, back, { error: "That product was not found." });
  }
  if (parent.parent_id) {
    redirectWith(slug, back, {
      error: "A variant cannot have variants of its own.",
    });
  }

  const title = readField(formData, "title");
  if (title.length < 2) {
    redirectWith(slug, back, { error: "Name the variant." });
  }

  // `${parent}-${variant}` keeps the two-level shape visible in the URL.
  const handle =
    readField(formData, "handle") || deriveHandle(parent.handle, title);
  const handleProblem = productHandleProblem(handle);
  if (handleProblem) {
    redirectWith(slug, back, { error: handleProblem });
  }

  const priceField = readField(formData, "price");
  const price =
    priceField === "" ? parent.price_cents : parsePriceCents(priceField);
  if (price === null) {
    redirectWith(slug, back, { error: "Enter a price, for example 24.99." });
  }

  const sku = readField(formData, "sku");
  if (sku.length > 64) {
    redirectWith(slug, back, { error: "Keep the SKU under 64 characters." });
  }

  const { error } = await context.supabase.from("products").insert({
    company_id: context.company.id,
    parent_id: parent.id,
    category_id: parent.category_id,
    title,
    handle,
    status: parent.status,
    kind: parent.kind,
    sku: sku || null,
    price_cents: price,
    currency: parent.currency,
    track_inventory: true,
    inventory_quantity: 0,
  });

  if (error) {
    redirectWith(slug, back, {
      error: writeErrorMessage(error, "That product address is already in use."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: `Added variant ${title}.` });
}

/** Sets a product's stock count, or turns counting off for it. */
export async function updateInventory(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, back, { error: "Choose a product first." });
  }

  // An unchecked checkbox submits nothing at all, so absence is "off".
  const trackInventory = readField(formData, "track_inventory") === "on";

  const quantityField = readField(formData, "inventory_quantity");
  const quantity =
    quantityField === "" ? null : readInt(formData, "inventory_quantity");
  if (quantityField !== "" && (quantity === null || quantity < 0)) {
    redirectWith(slug, back, {
      error: "Enter a stock count of zero or more.",
    });
  }

  const { error } = await context.supabase
    .from("products")
    .update({
      track_inventory: trackInventory,
      // Kept even when counting is off, so switching it back on restores the
      // last number instead of an empty box.
      inventory_quantity: quantity,
    })
    .eq("id", productId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: "Stock updated." });
}

/** Adds one bookable window to a date-based product. */
export async function addProductDate(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, back, { error: "Choose a product first." });
  }

  const startsOn = readField(formData, "starts_on");
  // A single-day window is the common case, so an empty end means "same day".
  const endsOn = readField(formData, "ends_on") || startsOn;
  const rangeProblem = dateRangeProblem(startsOn, endsOn);
  if (rangeProblem) {
    redirectWith(slug, back, { error: rangeProblem });
  }

  const quantity = readInt(formData, "inventory_quantity");
  if (quantity === null || quantity < 0) {
    redirectWith(slug, back, {
      error: "Enter how many are available on these dates.",
    });
  }

  const priceField = readField(formData, "price");
  const price = priceField === "" ? null : parsePriceCents(priceField);
  if (priceField !== "" && price === null) {
    redirectWith(slug, back, { error: "Enter a price, for example 24.99." });
  }

  const { error } = await context.supabase.from("product_dates").insert({
    company_id: context.company.id,
    product_id: productId,
    starts_on: startsOn,
    ends_on: endsOn,
    inventory_quantity: quantity,
    // `null` inherits the product price.
    price_cents: price,
  });

  if (error) {
    redirectWith(slug, back, {
      error: writeErrorMessage(error, "Those dates are already on this product."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: "Dates added." });
}

export async function deleteProductDate(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const dateId = readField(formData, "date_id");
  if (!dateId) {
    redirectWith(slug, back, { error: "Choose the dates to remove." });
  }

  const { error } = await context.supabase
    .from("product_dates")
    .delete()
    .eq("id", dateId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: "Dates removed." });
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------
const CATEGORIES_PATH = "products/categories";

export async function createCategory(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const name = readField(formData, "name");
  if (name.length < 2) {
    redirectWith(slug, CATEGORIES_PATH, { error: "Enter a category name." });
  }

  const handle = readField(formData, "handle") || deriveHandle(name);
  const handleProblem = categoryHandleProblem(handle);
  if (handleProblem) {
    redirectWith(slug, CATEGORIES_PATH, { error: handleProblem });
  }

  const { error } = await context.supabase.from("product_categories").insert({
    company_id: context.company.id,
    name,
    handle,
    description: readField(formData, "description") || null,
    position: readInt(formData, "position") ?? 0,
  });

  if (error) {
    redirectWith(slug, CATEGORIES_PATH, {
      error: writeErrorMessage(error, "That category address is already in use."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, CATEGORIES_PATH, { ok: `Added ${name}.` });
}

export async function updateCategory(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const categoryId = readField(formData, "category_id");
  if (!categoryId) {
    redirectWith(slug, CATEGORIES_PATH, { error: "Choose a category first." });
  }

  const name = readField(formData, "name");
  if (name.length < 2) {
    redirectWith(slug, CATEGORIES_PATH, { error: "Enter a category name." });
  }

  // Renaming a category must not rewrite its address, so the hidden current
  // handle is the fallback before the name is derived from.
  const handle =
    readField(formData, "handle") ||
    readField(formData, "current_handle") ||
    deriveHandle(name);
  const handleProblem = categoryHandleProblem(handle);
  if (handleProblem) {
    redirectWith(slug, CATEGORIES_PATH, { error: handleProblem });
  }

  const { error } = await context.supabase
    .from("product_categories")
    .update({
      name,
      handle,
      description: readField(formData, "description") || null,
      position: readInt(formData, "position") ?? 0,
    })
    .eq("id", categoryId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, CATEGORIES_PATH, {
      error: writeErrorMessage(error, "That category address is already in use."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, CATEGORIES_PATH, { ok: "Category saved." });
}

/**
 * Deletes a category, leaving its products in place.
 *
 * The composite foreign key is `on delete set null (category_id)`, so products
 * become uncategorised rather than disappearing with the aisle.
 */
export async function deleteCategory(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const categoryId = readField(formData, "category_id");
  if (!categoryId) {
    redirectWith(slug, CATEGORIES_PATH, { error: "Choose a category first." });
  }

  const { error } = await context.supabase
    .from("product_categories")
    .delete()
    .eq("id", categoryId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, CATEGORIES_PATH, { error: error.message });
  }

  revalidateProducts(slug);
  redirectWith(slug, CATEGORIES_PATH, {
    ok: "Category deleted. Its products were kept.",
  });
}

// -----------------------------------------------------------------------------
// Gallery
// -----------------------------------------------------------------------------
export type MediaUploadTarget =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string };

export type MediaActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Reserves a place in the bucket for one file and hands back a signed upload
 * URL.
 *
 * The browser then PUTs the file straight to Storage. Nothing here carries the
 * bytes: Server Actions default to a 1 MB body limit and the platform in front
 * of them caps a request at a few megabytes, which a phone video exceeds.
 *
 * Unlike the form actions, this one *answers* rather than redirects, because a
 * Client Component awaits it — so a refusal comes back as a result instead of a
 * thrown redirect.
 *
 * The URL is created with the caller's own client, so Storage applies this
 * section's insert policy (`<company>/<product>/…` plus the manager tier) before
 * it hands out a token at all.
 */
export async function createMediaUploadUrl(input: {
  slug: string;
  productId: string;
  contentType: string;
  size: number;
}): Promise<MediaUploadTarget> {
  const context = await getActionContext(input.slug);

  if (!canManage(context.role)) {
    return { ok: false, message: "You do not have permission to do that." };
  }
  if (!isSectionEnabled(context.company, "products")) {
    return {
      ok: false,
      message: "That extension is not enabled for this workspace.",
    };
  }

  const mediaType = mediaTypeFor(input.contentType);
  if (!mediaType) {
    return {
      ok: false,
      message: "Upload a PNG, JPEG, WebP, AVIF, MP4 or WebM file.",
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (input.size > PRODUCT_MEDIA_MAX_BYTES) {
    return { ok: false, message: "Keep files under 50 MB." };
  }

  // A path is not a place to discover product ids: prove the product is ours
  // before minting a token for its folder.
  const { data: product } = await context.supabase
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!product) {
    return { ok: false, message: "That product was not found." };
  }

  const path = productMediaPath(
    context.company.id,
    product.id,
    `${randomUUID()}.${mediaType.extension}`,
  );

  const { data, error } = await context.supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Could not start the upload.",
    };
  }

  return { ok: true, path: data.path, token: data.token };
}

/**
 * Records an upload that has already landed in the bucket.
 *
 * Called by the uploader after a successful PUT, so it re-checks the path: only
 * this workspace's folder for this product is accepted, whatever a modified
 * client might send.
 */
export async function recordMediaUpload(input: {
  slug: string;
  productId: string;
  path: string;
  contentType: string;
}): Promise<MediaActionResult> {
  const context = await getActionContext(input.slug);

  // Answered, not redirected: the uploader is awaiting this call.
  if (!canManage(context.role)) {
    return { ok: false, message: "You do not have permission to do that." };
  }
  if (!isSectionEnabled(context.company, "products")) {
    return {
      ok: false,
      message: "That extension is not enabled for this workspace.",
    };
  }

  const mediaType = mediaTypeFor(input.contentType);
  if (!mediaType) {
    return { ok: false, message: "That file type is not allowed." };
  }

  const expectedPrefix = productMediaPath(
    context.company.id,
    input.productId,
    "",
  );
  if (!input.path.startsWith(expectedPrefix) || input.path.includes("..")) {
    return { ok: false, message: "That upload path is not valid." };
  }

  const { error } = await context.supabase.from("product_media").insert({
    company_id: context.company.id,
    product_id: input.productId,
    kind: mediaType.kind,
    storage_path: input.path,
  });

  if (error) {
    return {
      ok: false,
      message: writeErrorMessage(error, "That file is already in the gallery."),
    };
  }

  revalidateProducts(input.slug);
  return { ok: true, message: "Added to the gallery." };
}

/** Attaches media that is hosted elsewhere, by URL. */
export async function addMediaLink(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const productId = readField(formData, "product_id");
  if (!productId) {
    redirectWith(slug, back, { error: "Choose a product first." });
  }

  const url = readField(formData, "url");
  if (!/^https?:\/\/\S+$/i.test(url)) {
    redirectWith(slug, back, { error: "Enter a full http(s) link." });
  }

  const { error } = await context.supabase.from("product_media").insert({
    company_id: context.company.id,
    product_id: productId,
    kind: readField(formData, "kind") === "video" ? "video" : "image",
    url,
    alt: readField(formData, "alt") || null,
  });

  if (error) {
    redirectWith(slug, back, {
      error: writeErrorMessage(error, "That link is already in the gallery."),
    });
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: "Link added to the gallery." });
}

/** Removes a gallery item, and its object from the bucket when it has one. */
export async function removeProductMedia(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireManager(context, slug);
  requireSection(context, slug, "products");

  const back = productPath(formData);
  const mediaId = readField(formData, "media_id");
  if (!mediaId) {
    redirectWith(slug, back, { error: "Choose a gallery item first." });
  }

  // Read the row first: deleting the object needs its path, and the storage
  // delete policy has to see the caller's membership on the same request.
  const { data: media } = await context.supabase
    .from("product_media")
    .select("id, storage_path")
    .eq("id", mediaId)
    .eq("company_id", context.company.id)
    .maybeSingle();

  if (!media) {
    redirectWith(slug, back, { error: "That gallery item was not found." });
  }

  const { error } = await context.supabase
    .from("product_media")
    .delete()
    .eq("id", mediaId)
    .eq("company_id", context.company.id);

  if (error) {
    redirectWith(slug, back, { error: error.message });
  }

  if (media.storage_path) {
    // The row is the source of truth and it is already gone; a stray object is
    // housekeeping, not a reason to fail the action in the user's face.
    const { error: storageError } = await context.supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .remove([media.storage_path]);

    if (storageError) {
      console.error(
        `Could not delete ${media.storage_path} from ${PRODUCT_MEDIA_BUCKET}:`,
        storageError.message,
      );
    }
  }

  revalidateProducts(slug);
  redirectWith(slug, back, { ok: "Removed from the gallery." });
}
