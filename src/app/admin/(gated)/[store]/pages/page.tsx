import type { Metadata } from "next";

import { StorePagesListView } from "./views";

export const metadata: Metadata = { title: "Pages" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/pages">) {
  return <StorePagesListView type="page" params={params} searchParams={searchParams} />;
}
