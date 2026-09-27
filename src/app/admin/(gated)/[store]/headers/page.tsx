import type { Metadata } from "next";

import { StorePagesListView } from "../pages/views";

export const metadata: Metadata = { title: "Headers" };

export default function Page({ params, searchParams }: PageProps<"/admin/[store]/headers">) {
  return <StorePagesListView type="header" params={params} searchParams={searchParams} />;
}
