import type { Metadata } from "next";

import { NewContentTypeView } from "@/components/admin/content-views";
import { requirePermission } from "@/server/permissions";

import { storeContentSite } from "../site";

export const metadata: Metadata = { title: "New content type" };

/** A new content type (D326), from scratch or from a starting point (`?preset=`). */
export default async function NewContentTypePage({ params, searchParams }: PageProps<"/admin/[store]/content/new">) {
  const member = await requirePermission((await params).store, "website:read");
  return <NewContentTypeView site={storeContentSite(member)} preset={(await searchParams).preset} />;
}
