import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ProductEditor } from "@/components/admin/product-editor";
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
  return <ProductEditor {...editorProps(store, context)} productId={null} initial={emptyProduct(context)} fields={fields} />;
}
