import type { Metadata } from "next";

import { requirePermission } from "@/server/permissions";

import { EntryView } from "../entry-view";

export const metadata: Metadata = { title: "Entry" };

/** An entry of a content type (D326). */
export default async function EntryPage({ params }: PageProps<"/admin/[store]/content/[typeId]/[entryId]">) {
  const { store, typeId, entryId } = await params;
  return <EntryView member={await requirePermission(store, "website:read")} typeId={typeId} entryId={entryId} />;
}
