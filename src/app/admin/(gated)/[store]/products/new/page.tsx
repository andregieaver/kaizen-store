import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProductEditor } from "@/components/admin/product-editor";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { fieldsForEditor } from "@/server/custom-fields";
import { emptyProduct, getEditorContext } from "@/server/products";

import { editorProps } from "../editor-props";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ params }: PageProps<"/admin/[store]/products/new">) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const context = await getEditorContext(store);
  const fields = await fieldsForEditor(store.id, "product", null);
  const lang = adminLangOf(gated.account.adminLocale);
  return (
    <AdminTextScope texts={adminTexts(lang, ["product", "products", "fields"])}>
      <ProductEditor {...editorProps(store, context, lang)} productId={null} initial={emptyProduct(context)} fields={fields} />
    </AdminTextScope>
  );
}
