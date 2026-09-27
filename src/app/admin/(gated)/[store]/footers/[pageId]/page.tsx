import type { Metadata } from "next";

import { StoreEditPageView } from "../../pages/views";

export const metadata: Metadata = { title: "Edit footer" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/footers/[pageId]">) {
  return <StoreEditPageView type="footer" params={params} searchParams={searchParams} />;
}
