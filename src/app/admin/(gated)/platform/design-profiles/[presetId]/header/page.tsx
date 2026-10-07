import type { Metadata } from "next";

import { LayoutTab } from "../layout-tab";

export const metadata: Metadata = { title: "Design profile header" };

export default async function Page({ params }: PageProps<"/admin/platform/design-profiles/[presetId]/header">) {
  return <LayoutTab presetId={(await params).presetId} kind="header" />;
}
