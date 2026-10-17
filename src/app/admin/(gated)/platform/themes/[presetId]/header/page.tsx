import type { Metadata } from "next";

import { LayoutTab } from "../layout-tab";

export const metadata: Metadata = { title: "Theme header" };

export default async function Page({ params }: PageProps<"/admin/platform/themes/[presetId]/header">) {
  return <LayoutTab presetId={(await params).presetId} kind="header" />;
}
