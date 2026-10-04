import type { Metadata } from "next";
import Link from "next/link";

import { TermsManager } from "@/components/admin/terms";
import { requirePermission } from "@/server/permissions";
import { listTerms } from "@/server/taxonomy";
import { categoryGaps } from "@/server/unit-price-gaps";

import { termFieldsSetup } from "../../fields/data";

import { createProductTermAction, deleteProductTermAction, updateProductTermAction } from "../actions";

export const metadata: Metadata = { title: "Product categories and tags" };

/** The store's product categories and tags (D50): chosen on each product, used in menus and content grids. */
export default async function ProductTermsPage({ params }: PageProps<"/admin/[store]/products/categories">) {
  const { store } = await requirePermission((await params).store, "products:read");
  const [terms, fields, gaps] = await Promise.all([
    listTerms({ storeId: store.id, contentType: "product" }),
    termFieldsSetup(store),
    categoryGaps(store.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/admin/${store.slug}/products`} className="w-fit text-sm underline">
          Products
        </Link>
        <h1 className="text-2xl font-semibold">Categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort your products into categories and label them with tags, so shoppers find them in your menus and
          content grids. Choose a product&apos;s categories and tags when you edit the product. A category can also
          require a price per kg or litre of its products.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy="products"
        fields={fields}
        // A category can need a price per kg or litre of its products (unit price, D160); the counts are of active products still without content.
        unitPrice={{ gaps: Object.fromEntries(gaps), needsHref: `/admin/${store.slug}/products?needs=unit-price` }}
        actions={{
          create: createProductTermAction.bind(null, store.slug),
          update: updateProductTermAction.bind(null, store.slug),
          remove: deleteProductTermAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}
