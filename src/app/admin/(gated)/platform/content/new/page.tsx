import type { Metadata } from "next";

import { NewContentTypeView } from "@/components/admin/content-views";
import { requirePlatformAdmin } from "@/server/auth";

import { platformContentSite } from "../site";

export const metadata: Metadata = { title: "New content type" };

/** A new content type of Kaizena Flow's own site (D326 H4). */
export default async function Page({ searchParams }: PageProps<"/admin/platform/content/new">) {
  return <NewContentTypeView site={platformContentSite(await requirePlatformAdmin())} preset={(await searchParams).preset} />;
}
