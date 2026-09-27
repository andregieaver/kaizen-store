import type { Metadata } from "next";

import { EditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit header" };

export default function Page({ params, searchParams }: PageProps<"/admin/platform/headers/[pageId]">) {
  return <EditPageView type="header" params={params} searchParams={searchParams} />;
}
