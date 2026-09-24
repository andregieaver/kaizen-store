import type { Metadata } from "next";

import { ProductEditor } from "@/components/admin/product-editor";
import { requireMember } from "@/server/auth";
import { emptyProduct, getEditorContext } from "@/server/products";

import { editorProps } from "../editor-props";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ params }: PageProps<"/admin/[store]/products/new">) {
  const { store } = await requireMember((await params).store);
  const context = await getEditorContext(store);
  return <ProductEditor {...editorProps(store, context)} productId={null} initial={emptyProduct(context)} />;
}
