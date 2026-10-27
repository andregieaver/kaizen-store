import type { Metadata } from "next";

import { ContentListView } from "@/components/admin/content-views";
import { requirePermission } from "@/server/permissions";

import { storeContentSite } from "./site";

export const metadata: Metadata = { title: "Content" };

/** The store's content types (D326): each with its number of entries and a way to add one; with none, starting points to begin from. */
export default async function ContentPage({ params }: PageProps<"/admin/[store]/content">) {
  return <ContentListView site={storeContentSite(await requirePermission((await params).store, "website:read"))} />;
}
