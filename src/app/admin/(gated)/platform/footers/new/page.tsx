import type { Metadata } from "next";

import { NewPageView } from "../../pages/editor-views";

export const metadata: Metadata = { title: "New footer" };

export default function Page({ searchParams }: PageProps<"/admin/platform/footers/new">) {
  return <NewPageView type="footer" searchParams={searchParams} />;
}
