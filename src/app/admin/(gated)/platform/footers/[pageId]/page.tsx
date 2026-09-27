import type { Metadata } from "next";

import { EditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit footer" };

export default function Page({ params, searchParams }: PageProps<"/admin/platform/footers/[pageId]">) {
  return <EditPageView type="footer" params={params} searchParams={searchParams} />;
}
