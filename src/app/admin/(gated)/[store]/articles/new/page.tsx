import type { Metadata } from "next";

import { StoreNewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New article" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/articles/new">) {
  return <StoreNewPageView type="article" params={params} searchParams={searchParams} />;
}
