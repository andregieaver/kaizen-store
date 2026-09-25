import type { Metadata } from "next";

import { PagesListView } from "./views";

export const metadata: Metadata = { title: "Pages" };

export default function Page({ searchParams }: PageProps<"/admin/platform/pages">) {
  return <PagesListView type="page" searchParams={searchParams} />;
}
