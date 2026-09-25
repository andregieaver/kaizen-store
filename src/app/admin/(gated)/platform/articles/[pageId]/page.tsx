import type { Metadata } from "next";

import { EditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit article" };

export default function Page({ params, searchParams }: PageProps<"/admin/platform/articles/[pageId]">) {
  return <EditPageView type="article" params={params} searchParams={searchParams} />;
}
