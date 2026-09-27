import type { Metadata } from "next";

import { StorePreviewPageView } from "../../../pages/views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/[store]/headers/[pageId]/preview">) {
  return <StorePreviewPageView type="header" params={params} />;
}
