import type { Metadata } from "next";

import { LayoutTab } from "../layout-tab";

export const metadata: Metadata = { title: "Design profile product page" };

export default async function Page({ params }: PageProps<"/admin/platform/design-profiles/[presetId]/product-layout">) {
  return <LayoutTab presetId={(await params).presetId} kind="productLayout" />;
}
