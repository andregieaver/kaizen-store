import type { Metadata } from "next";

import { NewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New header" };

export default function Page({ searchParams }: PageProps<"/admin/platform/headers/new">) {
  return <NewPageView type="header" searchParams={searchParams} />;
}
