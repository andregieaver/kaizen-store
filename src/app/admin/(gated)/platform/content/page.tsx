import type { Metadata } from "next";

import { ContentListView } from "@/components/admin/content-views";
import { requirePlatformAdmin } from "@/server/auth";

import { platformContentSite } from "./site";

export const metadata: Metadata = { title: "Content" };

/** Kaizena Flow's own content types (D326 H4). */
export default async function Page() {
  return <ContentListView site={platformContentSite(await requirePlatformAdmin())} />;
}
