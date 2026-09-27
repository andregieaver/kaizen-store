import type { Metadata } from "next";

import { StoreEditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit header" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/headers/[pageId]">) {
  return <StoreEditPageView type="header" params={params} searchParams={searchParams} />;
}
