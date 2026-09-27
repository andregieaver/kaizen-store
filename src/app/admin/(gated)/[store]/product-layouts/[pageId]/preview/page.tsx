import type { Metadata } from "next";

import { StorePreviewPageView } from "../../../pages/views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/product-layouts/[pageId]/preview">) {
  return <StorePreviewPageView type="product_layout" params={params} searchParams={searchParams} />;
}
