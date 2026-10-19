import type { Metadata } from "next";

import { PreviewPageView } from "../../../../pages/views";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** A theme store page's saved draft (D285); a theme's page shows the first theme, or the one `?theme=` names. */
export default function Page({ params, searchParams }: PageProps<"/admin/platform/themes/pages/[pageId]/preview">) {
  return <PreviewPageView type="page" params={params} searchParams={searchParams} themeStore />;
}
