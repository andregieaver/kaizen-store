import type { Metadata } from "next";

import { StorePagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Blog" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/articles">) {
  return <StorePagesListView type="article" params={params} searchParams={searchParams} />;
}
