import type { Metadata } from "next";

import { EntryView } from "@/components/admin/content-entry-views";
import { requirePlatformReader } from "@/server/auth";

import { platformContentSite } from "../../site";

export const metadata: Metadata = { title: "Entry" };

/** An entry on Kaizena Flow's own site (D326 H4). */
export default async function Page({ params }: PageProps<"/admin/platform/content/[typeId]/[entryId]">) {
  const { typeId, entryId } = await params;
  return <EntryView site={platformContentSite(await requirePlatformReader())} typeId={typeId} entryId={entryId} />;
}
