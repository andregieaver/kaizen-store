import type { Metadata } from "next";

import { StoreNewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New header" };

export default function Page({ params }: PageProps<"/admin/[store]/headers/new">) {
  return <StoreNewPageView type="header" params={params} />;
}
