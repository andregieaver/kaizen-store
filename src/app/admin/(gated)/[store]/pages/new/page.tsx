import type { Metadata } from "next";

import { StoreNewPageView } from "../views";

export const metadata: Metadata = { title: "New page" };

export default function Page({ params }: PageProps<"/admin/[store]/pages/new">) {
  return <StoreNewPageView type="page" params={params} />;
}
