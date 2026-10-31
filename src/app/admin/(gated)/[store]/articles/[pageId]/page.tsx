import type { Metadata } from "next";

import { StoreEditPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "Edit article" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/articles/[pageId]">) {
  return <StoreEditPageView type="article" params={params} searchParams={searchParams} />;
}
