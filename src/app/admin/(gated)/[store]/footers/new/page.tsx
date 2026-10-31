import type { Metadata } from "next";

import { StoreNewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New footer" };

export default function Page({ params }: PageProps<"/admin/[store]/footers/new">) {
  return <StoreNewPageView type="footer" params={params} />;
}
