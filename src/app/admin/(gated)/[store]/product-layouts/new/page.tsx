import type { Metadata } from "next";

import { StoreNewPageView } from "../../pages/views";

export const metadata: Metadata = { title: "New product layout" };

export default function Page({ params }: PageProps<"/admin/[store]/product-layouts/new">) {
  return <StoreNewPageView type="product_layout" params={params} />;
}
