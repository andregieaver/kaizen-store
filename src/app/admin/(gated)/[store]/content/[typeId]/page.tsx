import type { Metadata } from "next";

import { ContentEntriesView } from "@/components/admin/content-views";
import { requirePermission } from "@/server/permissions";

import { storeContentSite } from "../site";

export const metadata: Metadata = { title: "Content type entries" };

/** A content type's entries in the store's order (D326). */
export default async function ContentTypePage({ params, searchParams }: PageProps<"/admin/[store]/content/[typeId]">) {
  const { store, typeId } = await params;
  const member = await requirePermission(store, "website:read");
  return <ContentEntriesView site={storeContentSite(member)} typeId={typeId} q={(await searchParams).q} />;
}
