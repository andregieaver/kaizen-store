import type { Metadata } from "next";

import { EntryView } from "@/components/admin/content-views";
import { requirePlatformAdmin } from "@/server/auth";

import { platformContentSite } from "../../site";

export const metadata: Metadata = { title: "New entry" };

/** A new entry on Kaizena Flow's own site (D326 H4). */
export default async function Page({ params }: PageProps<"/admin/platform/content/[typeId]/new">) {
  const site = platformContentSite(await requirePlatformAdmin());
  return <EntryView site={site} typeId={(await params).typeId} entryId={null} />;
}
