import type { Metadata } from "next";

import { ContentEntriesView } from "@/components/admin/content-views";
import { requirePlatformAdmin } from "@/server/auth";

import { platformContentSite } from "../site";

export const metadata: Metadata = { title: "Content type entries" };

/** A content type's entries on Kaizena Flow's own site (D326 H4). */
export default async function Page({ params, searchParams }: PageProps<"/admin/platform/content/[typeId]">) {
  const site = platformContentSite(await requirePlatformAdmin());
  return <ContentEntriesView site={site} typeId={(await params).typeId} q={(await searchParams).q} />;
}
