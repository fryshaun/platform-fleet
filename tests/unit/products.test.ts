import { describe, expect, it } from "vitest";

import {
  categoryHandleProblem,
  dateRangeProblem,
  deriveHandle,
  familyPriceLabel,
  formatDateRange,
  formatPriceCents,
  formatProductPrice,
  groupVariants,
  inventoryLabel,
  isLowStock,
  LOW_STOCK_THRESHOLD,
  mediaTypeFor,
  parsePriceCents,
  priceInputValue,
  PRODUCT_MEDIA_ACCEPT,
  PRODUCT_MEDIA_MAX_BYTES,
  PRODUCT_MEDIA_TYPES,
  productHandleProblem,
  productMediaPath,
} from "@/lib/products";

import { COMPANY_ID, productRow, PRODUCT_ID } from "../helpers/fixtures";

describe("deriveHandle", () => {
  it("slugifies the title", () => {
    expect(deriveHandle("Espresso Beans, 1kg")).toBe("espresso-beans-1kg");
  });

  it("joins the parts it is given", () => {
    // Variants use `<parent>-<variant>`, so the two-level shape shows in the URL.
    expect(deriveHandle("espresso-beans", "Large")).toBe("espresso-beans-large");
  });

  it("ignores empty parts", () => {
    expect(deriveHandle("", "Large")).toBe("large");
  });
});

describe("productHandleProblem", () => {
  it("accepts a usable handle", () => {
    expect(productHandleProblem("espresso-beans")).toBeNull();
  });

  it("asks for one when it is empty", () => {
    expect(productHandleProblem("")).toBe("Enter a product address.");
  });

  it("refuses the section's own routes", () => {
    // `/products/new` and `/products/categories` are pages, not products.
    for (const handle of ["new", "categories"]) {
      expect(productHandleProblem(handle)).toMatch(/reserved/);
    }
  });

  it("reports a handle that is too short", () => {
    expect(productHandleProblem("ab")).toBe("Use at least 3 characters.");
  });

  it("reports a malformed handle", () => {
    expect(productHandleProblem("Espresso Beans")).toMatch(/lowercase/);
    expect(productHandleProblem("-beans-")).toMatch(/lowercase/);
  });

  it("uses the category wording for categories", () => {
    expect(categoryHandleProblem("")).toBe("Enter a category address.");
    expect(categoryHandleProblem("hot-drinks")).toBeNull();
  });
});

describe("parsePriceCents", () => {
  it("reads an amount as minor units", () => {
    expect(parsePriceCents("24.99")).toBe(2499);
    expect(parsePriceCents("24.9")).toBe(2490);
    expect(parsePriceCents("24")).toBe(2400);
    expect(parsePriceCents("0")).toBe(0);
    expect(parsePriceCents(" 7.05 ")).toBe(705);
  });

  it("rejects anything it cannot store exactly", () => {
    for (const value of ["", "-1", "1.234", "12,50", "abc", "1e5"]) {
      expect(parsePriceCents(value)).toBeNull();
    }
  });
});

describe("price display", () => {
  it("round-trips an amount through the input value", () => {
    expect(priceInputValue(2499)).toBe("24.99");
    expect(priceInputValue(2400)).toBe("24.00");
    expect(priceInputValue(null)).toBe("");
  });

  it("formats with the same helper the plan picker uses", () => {
    expect(formatPriceCents(2499, "usd")).toBe("$24.99");
    expect(formatPriceCents(2499, "eur")).toBe("€24.99");
    expect(formatProductPrice(productRow({ price_cents: 0 }))).toBe("$0.00");
  });
});

describe("inventoryLabel", () => {
  it("describes a counted item", () => {
    expect(inventoryLabel(productRow({ inventory_quantity: 4 }))).toBe(
      "4 in stock",
    );
    expect(inventoryLabel(productRow({ inventory_quantity: 0 }))).toBe(
      "Out of stock",
    );
    expect(inventoryLabel(productRow({ inventory_quantity: null }))).toBe(
      "Not counted",
    );
  });

  it("says so when the shop does not count it", () => {
    expect(inventoryLabel(productRow({ track_inventory: false }))).toBe(
      "Not tracked",
    );
  });

  it("defers to the dates for a booked product", () => {
    expect(inventoryLabel(productRow({ kind: "dated" }))).toBe(
      "Stocked per date",
    );
  });
});

describe("isLowStock", () => {
  it("flags a counted item at or below the threshold", () => {
    expect(isLowStock(productRow({ inventory_quantity: 0 }))).toBe(true);
    expect(
      isLowStock(productRow({ inventory_quantity: LOW_STOCK_THRESHOLD })),
    ).toBe(true);
    expect(
      isLowStock(productRow({ inventory_quantity: LOW_STOCK_THRESHOLD + 1 })),
    ).toBe(false);
  });

  it("ignores products that are not counted", () => {
    expect(
      isLowStock(productRow({ track_inventory: false, inventory_quantity: 0 })),
    ).toBe(false);
    expect(isLowStock(productRow({ kind: "dated", inventory_quantity: 0 }))).toBe(
      false,
    );
    expect(isLowStock(productRow({ inventory_quantity: null }))).toBe(false);
  });
});

describe("groupVariants", () => {
  it("puts each variant under its parent", () => {
    const parent = productRow();
    const large = productRow({
      id: "variant-1",
      parent_id: PRODUCT_ID,
      title: "Large",
    });
    const small = productRow({
      id: "variant-2",
      parent_id: PRODUCT_ID,
      title: "Small",
    });

    const families = groupVariants([large, parent, small]);

    expect(families).toHaveLength(1);
    expect(families[0]!.parent.id).toBe(PRODUCT_ID);
    expect(families[0]!.variants.map((variant) => variant.title)).toEqual([
      "Large",
      "Small",
    ]);
  });

  it("leaves a lone product with no variants", () => {
    expect(groupVariants([productRow()])).toEqual([
      { parent: expect.objectContaining({ id: PRODUCT_ID }), variants: [] },
    ]);
  });

  it("drops a variant whose parent was filtered out", () => {
    // A filtered list can hold variants without their parent; showing them as
    // top-level products would misrepresent the catalogue.
    expect(
      groupVariants([productRow({ id: "orphan", parent_id: PRODUCT_ID })]),
    ).toEqual([]);
  });
});

describe("familyPriceLabel", () => {
  it("shows the parent price when nothing is cheaper", () => {
    const family = { parent: productRow({ price_cents: 1800 }), variants: [] };
    expect(familyPriceLabel(family)).toBe("$18.00");
  });

  it("shows the cheapest variant as a starting price", () => {
    const family = {
      parent: productRow({ price_cents: 1800 }),
      variants: [productRow({ id: "cheap", price_cents: 900 })],
    };
    expect(familyPriceLabel(family)).toBe("From $9.00");
  });
});

describe("date-based stock", () => {
  it("accepts a window in order", () => {
    expect(dateRangeProblem("2026-03-04", "2026-03-08")).toBeNull();
    expect(dateRangeProblem("2026-03-04", "2026-03-04")).toBeNull();
  });

  it("refuses a window that runs backwards", () => {
    expect(dateRangeProblem("2026-03-08", "2026-03-04")).toBe(
      "The end date must be on or after the start date.",
    );
  });

  it("refuses anything that is not a date input value", () => {
    for (const value of ["", "4 March", "2026-3-4"]) {
      expect(dateRangeProblem(value, "2026-03-08")).toBe(
        "Choose a start and an end date.",
      );
    }
  });

  it("formats a single day and a window", () => {
    expect(formatDateRange("2026-03-04", "2026-03-04")).toBe("Mar 4, 2026");
    expect(formatDateRange("2026-03-04", "2026-03-08")).toBe(
      "Mar 4, 2026 – Mar 8, 2026",
    );
  });
});

describe("gallery media", () => {
  it("knows which uploads the bucket accepts", () => {
    expect(mediaTypeFor("image/png")?.kind).toBe("image");
    expect(mediaTypeFor("video/mp4")).toEqual({
      mime: "video/mp4",
      extension: "mp4",
      kind: "video",
    });
    expect(mediaTypeFor("application/pdf")).toBeNull();
    expect(mediaTypeFor("image/gif")).toBeNull();
  });

  it("lists every accepted type in the file input", () => {
    for (const type of PRODUCT_MEDIA_TYPES) {
      expect(PRODUCT_MEDIA_ACCEPT.split(",")).toContain(type.mime);
    }
  });

  it("keeps the 50 MB ceiling the bucket is configured with", () => {
    expect(PRODUCT_MEDIA_MAX_BYTES).toBe(52_428_800);
  });

  it("builds the path the storage policies parse", () => {
    // First segment is the company, second the product: exactly what
    // `storage_company_id()` reads back.
    expect(productMediaPath(COMPANY_ID, PRODUCT_ID, "one.png")).toBe(
      `${COMPANY_ID}/${PRODUCT_ID}/one.png`,
    );
  });
});
