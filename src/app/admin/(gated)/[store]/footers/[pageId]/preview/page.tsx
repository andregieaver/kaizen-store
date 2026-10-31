import type { Metadata } from "next";

import { StorePreviewPageView } from "../../../pages/editor-views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/footers/[pageId]/preview">) {
  return <StorePreviewPageView type="footer" params={params} searchParams={searchParams} />;
}
