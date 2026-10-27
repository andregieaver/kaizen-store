import type { Metadata } from "next";

import { requirePermission } from "@/server/permissions";

import { EntryView } from "../entry-view";

export const metadata: Metadata = { title: "New entry" };

/** A new entry of a content type (D326). */
export default async function NewEntryPage({ params }: PageProps<"/admin/[store]/content/[typeId]/new">) {
  const { store, typeId } = await params;
  return <EntryView member={await requirePermission(store, "website:read")} typeId={typeId} entryId={null} />;
}
