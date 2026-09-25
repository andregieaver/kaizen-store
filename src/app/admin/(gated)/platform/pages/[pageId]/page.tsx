import type { Metadata } from "next";

import { EditPageView } from "../views";

export const metadata: Metadata = { title: "Edit page" };

export default function Page({ params, searchParams }: PageProps<"/admin/platform/pages/[pageId]">) {
  return <EditPageView type="page" params={params} searchParams={searchParams} />;
}
