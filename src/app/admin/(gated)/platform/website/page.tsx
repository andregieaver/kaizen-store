import type { Metadata } from "next";
import { connection } from "next/server";

import { HouseSiteCard } from "@/components/admin/house-site-card";
import { SiteSwitchCard } from "@/components/admin/site-switch-card";
import { SectionHub } from "@/components/admin/section-hub";
import { adminLangOf } from "@/lib/admin-lang";
import { HOUSE_STORE_CARD, PLATFORM_HUB_INTROS, PLATFORM_HUB_TITLES, WEBSITE_ITEMS } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";
import { lastSiteCopy } from "@/server/house-site";
import { siteSwitch } from "@/server/house-switch";

import { copySiteAction, switchSiteOffAction, switchSiteOnAction } from "./actions";

export const metadata: Metadata = { title: "Website" };

/** Kaizen's own website (D144): its pages, blog, media, menus, header, footer and fonts. */
export default async function PlatformWebsitePage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  const [last, state] = await Promise.all([lastSiteCopy(), siteSwitch()]);
  return (
    <div className="flex flex-col gap-8">
      <SectionHub
        lang={lang}
        title={PLATFORM_HUB_TITLES.website}
        intro={PLATFORM_HUB_INTROS.website}
        // Kaizena Flow's own store first (D466): where its site and customers move.
        items={[HOUSE_STORE_CARD, ...WEBSITE_ITEMS]}
      />
      {/* Step 3 of the plan (D469): the site copied into the store, to look at beside the live one; not again once the store serves it. */}
      {!state.on && <HouseSiteCard lang={lang} last={last} copy={copySiteAction} />}
      {/* Step 5 of the plan (D474): kaizenaflow.com served from the store, or back. */}
      <SiteSwitchCard lang={lang} state={state} on={switchSiteOnAction} off={switchSiteOffAction} />
    </div>
  );
}
