import type { Metadata } from "next";

import { ContentTypeSettingsView } from "@/components/admin/content-views";
import { requirePermission } from "@/server/permissions";

import { storeContentSite } from "../../site";

export const metadata: Metadata = { title: "Content type settings" };

/** A content type's name, web name, fields and pages (D326), its entry page, and deleting it with its entries. */
export default async function ContentTypeSettingsPage({ params }: PageProps<"/admin/[store]/content/[typeId]/settings">) {
  const { store, typeId } = await params;
  return <ContentTypeSettingsView site={storeContentSite(await requirePermission(store, "website:read"))} typeId={typeId} />;
}
