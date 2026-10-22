import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_HUB_INTROS, SETTINGS_ITEMS } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

/** Kaizen's own settings (D144): how its site is found and consented to, payments, AI, email and languages. */
export default async function PlatformSettingsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformAdmin();
  return (
    <SectionHub
      lang={adminLangOf(admin.adminLocale)}
      title="Settings"
      intro={PLATFORM_HUB_INTROS.settings}
      items={SETTINGS_ITEMS}
    />
  );
}
