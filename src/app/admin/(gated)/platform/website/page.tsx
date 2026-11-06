import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { adminLangOf } from "@/lib/admin-lang";
import { HOUSE_STORE_CARD, PLATFORM_HUB_INTROS, PLATFORM_HUB_TITLES, WEBSITE_ITEMS } from "@/lib/platform-nav";
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
      title={PLATFORM_HUB_TITLES.website}
      intro={PLATFORM_HUB_INTROS.website}
      // Kaizena Flow's own store first (D466): where its site and customers move.
      items={[HOUSE_STORE_CARD, ...WEBSITE_ITEMS]}
    />
  );
}
