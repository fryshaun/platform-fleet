import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Product } from "@/lib/products";

import { ProductFields, type ProductCategoryOption } from "./product-fields";

export type { ProductCategoryOption };

/**
 * The product editor card, used for editing a product on its own page.
 *
 * Creating one normally happens in the slideout on the index, which is the same
 * field set; this card is what the standalone `/products/new` page renders, and
 * what "Details" looks like once the product exists. Everything is a plain form
 * posting to a Server Action: the page stays server-rendered and the result
 * arrives as `?ok=` / `?error=`.
 */
export function ProductForm({
  slug,
  categories,
  product,
}: {
  slug: string;
  categories: ProductCategoryOption[];
  product?: Product;
}) {
  const isEdit = Boolean(product);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Details" : "New product"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Name, address, price and where this product sits in the shop."
            : "Start with the basics. Stock, variants, dates and gallery media are added from the product page afterwards."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* `surface="page"`: a failed create returns here, not to the index
            panel it would otherwise be told to reopen. */}
        <ProductFields
          slug={slug}
          categories={categories}
          product={product}
          surface="page"
        />
      </CardContent>
    </Card>
  );
}

