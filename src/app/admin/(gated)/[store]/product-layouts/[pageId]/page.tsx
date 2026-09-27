import type { Metadata } from "next";

import { StoreEditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit product layout" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/product-layouts/[pageId]">) {
  return <StoreEditPageView type="product_layout" params={params} searchParams={searchParams} />;
}
