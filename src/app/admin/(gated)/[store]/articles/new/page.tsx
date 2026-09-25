import type { Metadata } from "next";

import { StoreNewPageView } from "../../pages/views";

export const metadata: Metadata = { title: "New article" };

export default function Page({ params }: PageProps<"/admin/[store]/articles/new">) {
  return <StoreNewPageView type="article" params={params} />;
}
