import type { Metadata } from "next";
import { connection } from "next/server";

import { SectionHub } from "@/components/admin/section-hub";
import { SETTINGS_ITEMS } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

/** Kaizen's own settings (D144): how its site is found and consented to, payments, AI, email and languages. */
export default async function PlatformSettingsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  return (
    <SectionHub
      title="Settings"
      intro="How Kaizen's site is found, what it sets, how it takes payment, its AI, emails and languages."
      items={SETTINGS_ITEMS}
    />
  );
}
