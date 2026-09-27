import type { Metadata } from "next";

import { StorePagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Product layouts" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/product-layouts">) {
  return <StorePagesListView type="product_layout" params={params} searchParams={searchParams} />;
}
