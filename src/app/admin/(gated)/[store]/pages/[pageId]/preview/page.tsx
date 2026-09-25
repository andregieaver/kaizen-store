import type { Metadata } from "next";

import { StorePreviewPageView } from "../../views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/[store]/pages/[pageId]/preview">) {
  return <StorePreviewPageView type="page" params={params} />;
}
