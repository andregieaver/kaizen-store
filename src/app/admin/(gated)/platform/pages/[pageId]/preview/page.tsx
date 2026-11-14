import type { Metadata } from "next";

import { PreviewPageView } from "../../preview-views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/platform/pages/[pageId]/preview">) {
  return <PreviewPageView type="page" params={params} />;
}
