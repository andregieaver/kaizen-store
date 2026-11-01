import type { Metadata } from "next";

import { NewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New article" };

export default function Page({ searchParams }: PageProps<"/admin/platform/articles/new">) {
  return <NewPageView type="article" searchParams={searchParams} />;
}
