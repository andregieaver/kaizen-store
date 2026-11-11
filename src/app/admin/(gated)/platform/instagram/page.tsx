import type { Metadata } from "next";

import { AdminAreas } from "@/components/admin/admin-areas";
import { InstagramSettings, instagramReturned } from "@/components/admin/instagram-settings";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { platformCan, requirePlatform } from "@/server/auth";
import { instagramAppOn, instagramStatus } from "@/server/instagram";

import { connectPlatformInstagramAction, disconnectPlatformInstagramAction } from "./actions";

export const metadata: Metadata = { title: "Instagram" };

/** Kaizena Flow's own Instagram account (D559), for the Instagram feeds on its own pages; stores connect their own. */
export default async function PlatformInstagramPage({ searchParams }: PageProps<"/admin/platform/instagram">) {
  const admin = await requirePlatform("settings", "read");
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "notifications").instagram;
  return (
    <AdminAreas areas={["notifications"]}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <InstagramSettings
          status={await instagramStatus(null)}
          appOn={instagramAppOn()}
          canEdit={platformCan(admin, "settings")}
          lang={lang}
          pictureBase="/api/instagram/kaizen"
          returned={instagramReturned((await searchParams).instagram)}
          connect={connectPlatformInstagramAction}
          disconnect={disconnectPlatformInstagramAction}
        />
      </div>
    </AdminAreas>
  );
}
