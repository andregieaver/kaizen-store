import type { Metadata } from "next";

import { LayoutTab } from "../layout-tab";

export const metadata: Metadata = { title: "Design profile footer" };

export default async function Page({ params }: PageProps<"/admin/platform/design-profiles/[presetId]/footer">) {
  return <LayoutTab presetId={(await params).presetId} kind="footer" />;
}
