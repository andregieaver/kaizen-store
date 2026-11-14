import type { Metadata } from "next";

import { ContentTypeSettingsView } from "@/components/admin/content-type-views";
import { requirePlatformReader } from "@/server/auth";

import { platformContentSite } from "../../site";

export const metadata: Metadata = { title: "Content type settings" };

/** A content type of Kaizena Flow's own site: its name, web name, fields and pages (D326 H4). */
export default async function Page({ params }: PageProps<"/admin/platform/content/[typeId]/settings">) {
  const site = platformContentSite(await requirePlatformReader());
  return <ContentTypeSettingsView site={site} typeId={(await params).typeId} />;
}
