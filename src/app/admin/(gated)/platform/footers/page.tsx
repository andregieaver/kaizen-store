import type { Metadata } from "next";

import { PagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Footers" };

export default function Page({ searchParams }: PageProps<"/admin/platform/footers">) {
  return <PagesListView type="footer" searchParams={searchParams} />;
}
