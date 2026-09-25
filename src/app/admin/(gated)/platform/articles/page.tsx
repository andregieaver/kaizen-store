import type { Metadata } from "next";

import { PagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Blog" };

export default function Page({ searchParams }: PageProps<"/admin/platform/articles">) {
  return <PagesListView type="article" searchParams={searchParams} />;
}
