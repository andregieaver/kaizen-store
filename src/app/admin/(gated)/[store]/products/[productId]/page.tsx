import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ProductEditor } from "@/components/admin/product-editor";
import { requirePermission } from "@/server/permissions";
import { fieldsForEditor } from "@/server/custom-fields";
import { getEditorContext, getProductForEdit } from "@/server/products";

import { archiveProductAction } from "../actions";
import { editorProps } from "../editor-props";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/[store]/products/[productId]">) {
  const { store: slug, productId } = await params;
  const gated = await requirePermission(slug, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(productId).success) notFound();
  const context = await getEditorContext(store);
  const product = await getProductForEdit(store, context, productId);
  if (!product) notFound();
  const { archived, ...initial } = product;
  const fields = await fieldsForEditor(store.id, "product", productId);

  return (
    <div className="flex flex-col gap-6">
      {archived && (
        <p role="status" className="rounded-md border border-border bg-background p-3 text-sm">
          This product is archived: shoppers cannot see it.
        </p>
      )}
      <ProductEditor {...editorProps(store, context)} productId={productId} initial={initial} fields={fields} />
      <form
        action={archiveProductAction.bind(null, store.slug, productId, !archived)}
        className="border-t border-border pt-4"
      >
        <button type="submit" className="text-sm underline">
          {archived ? "Restore this product (as a draft)" : "Archive this product"}
        </button>
        {!archived && (
          <span className="ml-2 text-sm text-muted">
            Takes it off sale and out of the list. Order history is kept.
          </span>
        )}
      </form>
    </div>
  );
}
