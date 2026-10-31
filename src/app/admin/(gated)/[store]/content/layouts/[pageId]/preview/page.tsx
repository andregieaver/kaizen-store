import type { Metadata } from "next";

import { StorePreviewPageView } from "../../../../pages/editor-views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/[store]/content/layouts/[pageId]/preview">) {
  return <StorePreviewPageView type="entry_layout" params={params} />;
}
