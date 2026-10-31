import type { Metadata } from "next";

import { EditPageView } from "../../../pages/editor-views";

export const metadata: Metadata = { title: "Edit theme store page" };

/** One of the theme store's own pages (D285) in the page builder, opened from Themes. */
export default function Page({ params, searchParams }: PageProps<"/admin/platform/themes/pages/[pageId]">) {
  return <EditPageView type="page" params={params} searchParams={searchParams} themeStore />;
}
