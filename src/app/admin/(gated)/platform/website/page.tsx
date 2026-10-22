import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_HUB_INTROS, WEBSITE_ITEMS } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Website" };

/** Kaizen's own website (D144): its pages, blog, media, menus, header, footer and fonts. */
export default async function PlatformWebsitePage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformAdmin();
  return (
    <SectionHub
      lang={adminLangOf(admin.adminLocale)}
      title="Website"
      intro={PLATFORM_HUB_INTROS.website}
      items={WEBSITE_ITEMS}
    />
  );
}
