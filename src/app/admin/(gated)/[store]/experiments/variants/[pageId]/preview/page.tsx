import type { Metadata } from "next";

import { StorePreviewPageView } from "../../../../pages/editor-views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/[store]/experiments/variants/[pageId]/preview">) {
  return <StorePreviewPageView type="variant" params={params} />;
}
