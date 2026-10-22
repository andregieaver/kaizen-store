import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProductEditor } from "@/components/admin/product-editor";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
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
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "product").page;

  return (
    <div className="flex flex-col gap-6">
      {archived && (
        <p role="status" className="rounded-md border border-line bg-card p-3 text-sm">
          {w.archived}
        </p>
      )}
      <AdminTextScope texts={adminTexts(lang, ["product", "products", "fields"])}>
        <ProductEditor {...editorProps(store, context, lang)} productId={productId} initial={initial} fields={fields} />
      </AdminTextScope>
      <form
        action={archiveProductAction.bind(null, store.slug, productId, !archived)}
        className="border-t border-line pt-4"
      >
        <button type="submit" className="text-sm underline">
          {archived ? w.restore : w.archive}
        </button>
        {!archived && (
          <span className="ml-2 text-sm text-muted">{w.archiveHint}</span>
        )}
      </form>
    </div>
  );
}
