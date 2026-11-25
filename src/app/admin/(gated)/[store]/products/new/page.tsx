import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProductEditor } from "@/components/admin/product-editor";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { BUILDER_TEXT_WORDS } from "@/lib/admin-words/builder-text";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { FIELDS_EDITOR_WORDS } from "@/lib/admin-words/fields-editor";
import { PRODUCT_WORDS } from "@/lib/admin-words/product";
import { PRODUCTS_EDITOR_WORDS } from "@/lib/admin-words/products-editor";
import { WEBSITE_PICK_WORDS } from "@/lib/admin-words/website-pick";
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
    <AdminTextScope texts={areaTexts(lang, { product: PRODUCT_WORDS, productsEditor: PRODUCTS_EDITOR_WORDS, fieldsEditor: FIELDS_EDITOR_WORDS, builderText: BUILDER_TEXT_WORDS, websitePick: WEBSITE_PICK_WORDS, canva: CANVA_WORDS })}>
      <ProductEditor {...(await editorProps(store, context, lang))} productId={null} initial={emptyProduct(context)} fields={fields} />
    </AdminTextScope>
  );
}
