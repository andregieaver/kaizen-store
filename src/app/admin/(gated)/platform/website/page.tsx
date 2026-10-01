import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { WEBSITE_ITEMS } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Website" };

/** Kaizen's own website (D144): its pages, blog, media, menus, header, footer and fonts. */
export default async function PlatformWebsitePage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  return (
    <SectionHub
      title="Website"
      intro="Everything that makes Kaizen's own site: build its pages and blog, keep its pictures, menus, header, footer and fonts."
      items={WEBSITE_ITEMS}
    />
  );
}
