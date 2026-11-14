import type { Metadata } from "next";
import { connection } from "next/server";

import { SettingsHub } from "@/components/admin/settings-hub";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_BASE, PLATFORM_HUB_INTROS, PLATFORM_HUB_TITLES, SETTINGS_ITEMS } from "@/lib/platform-nav";
import { requirePlatformReader } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

/**
 * Kaizen's own settings (D144; round 2, D597): the store's settings hub with the platform's pages, compact cards with a line each and a search
 * over them. The platform has no setup to finish, so no strip of essentials.
 */
export default async function PlatformSettingsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const t = adminText(lang, "home").settings;
  const cards = SETTINGS_ITEMS.map((item) => ({
    href: `${PLATFORM_BASE}${item.path}`,
    label: navWord(lang, item.label),
    icon: item.icon,
    hint: navWord(lang, item.description),
    words: `${item.label} ${item.description}`,
  }));
  return (
    <SettingsHub
      title={navWord(lang, PLATFORM_HUB_TITLES.settings)}
      lead={navWord(lang, PLATFORM_HUB_INTROS.settings)}
      progress={null}
      groups={[{ heading: "", items: cards }]}
      rest={[]}
      words={{ find: t.find, findPlaceholder: t.findPlaceholder, progressSub: t.progressSub, everythingElse: t.everythingElse, everythingElseSub: countWords(0, t.everythingElseSub) }}
    />
  );
}
