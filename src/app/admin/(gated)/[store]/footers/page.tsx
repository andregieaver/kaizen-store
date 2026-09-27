import type { Metadata } from "next";

import { StorePagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Footers" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/footers">) {
  return <StorePagesListView type="footer" params={params} searchParams={searchParams} />;
}
