import type { Metadata } from "next";

import { PreviewPageView } from "../../../pages/views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/admin/platform/headers/[pageId]/preview">) {
  return <PreviewPageView type="header" params={params} />;
}
