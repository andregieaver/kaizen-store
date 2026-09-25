import type { Metadata } from "next";
import Link from "next/link";

import { TermsManager } from "@/components/admin/terms";
import { requireMember } from "@/server/auth";
import { listTerms } from "@/server/taxonomy";

import { createProductTermAction, deleteProductTermAction, updateProductTermAction } from "../actions";

export const metadata: Metadata = { title: "Product categories and tags" };

/** The store's product categories and tags (D50): chosen on each product, used in menus and content grids. */
export default async function ProductTermsPage({ params }: PageProps<"/admin/[store]/products/categories">) {
  const { store } = await requireMember((await params).store);
  const terms = await listTerms({ storeId: store.id, contentType: "product" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/admin/${store.slug}/products`} className="w-fit text-sm underline">
          Products
        </Link>
        <h1 className="text-2xl font-semibold">Categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort your products into categories and label them with tags, so shoppers find them in your menus and
          content grids. Choose a product&apos;s categories and tags when you edit the product.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy="products"
        actions={{
          create: createProductTermAction.bind(null, store.slug),
          update: updateProductTermAction.bind(null, store.slug),
          remove: deleteProductTermAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}
