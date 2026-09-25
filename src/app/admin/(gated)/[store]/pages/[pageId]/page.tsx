import type { Metadata } from "next";

import { StoreEditPageView } from "../views";

export const metadata: Metadata = { title: "Edit page" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/pages/[pageId]">) {
  return <StoreEditPageView type="page" params={params} searchParams={searchParams} />;
}
