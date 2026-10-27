import type { Metadata } from "next";

import { EntryView } from "@/components/admin/content-views";
import { requirePermission } from "@/server/permissions";

import { storeContentSite } from "../../site";

export const metadata: Metadata = { title: "Entry" };

/** An entry of a content type (D326). */
export default async function EntryPage({ params }: PageProps<"/admin/[store]/content/[typeId]/[entryId]">) {
  const { store, typeId, entryId } = await params;
  return <EntryView site={storeContentSite(await requirePermission(store, "website:read"))} typeId={typeId} entryId={entryId} />;
}
