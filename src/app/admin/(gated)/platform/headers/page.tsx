import type { Metadata } from "next";

import { PagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Headers" };

export default function Page({ searchParams }: PageProps<"/admin/platform/headers">) {
  return <PagesListView type="header" searchParams={searchParams} />;
}
