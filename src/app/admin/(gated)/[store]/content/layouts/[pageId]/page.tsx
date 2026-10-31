import type { Metadata } from "next";

import { StoreEditPageView } from "../../../pages/editor-views";

export const metadata: Metadata = { title: "Edit entry page" };

/** A content type's entry page (D326), designed in the page builder from the type's settings. */
export default function Page({ params, searchParams }: PageProps<"/admin/[store]/content/layouts/[pageId]">) {
  return <StoreEditPageView type="entry_layout" params={params} searchParams={searchParams} />;
}
