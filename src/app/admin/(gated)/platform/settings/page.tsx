import type { Metadata } from "next";
import { connection } from "next/server";

import { SettingsHub } from "@/components/admin/settings-hub";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { PLATFORM_BASE, platformSection } from "@/lib/platform-nav";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { requirePlatformReader } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

/**
 * Kaizen's own settings (D144; round 2, D597): the store's settings hub with the platform's pages, compact cards with a line each in the
 * section's six groups (D884) and a search over them. The platform has no setup to finish, so no strip of essentials.
 */
export default async function PlatformSettingsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const t = HOME_WORDS[lang].settings;
  // The section's own words and pages (`PLATFORM_SECTIONS`, D877): the cards are its sidebar's pages, in its six groups and its order (D884).
  // Every card in either view, as a store's Settings lists every setting (D597); the sidebar beside them follows Basic or Advanced.
  const section = platformSection("settings");
  const groups = section.groups.map((group) => {
    const heading = navWord(lang, group.heading);
    // The search finds a card by its group's name too ("privacy", "money"), in English and in the account's language.
    const groupWords = heading === group.heading ? heading : `${group.heading} ${heading}`;
    return {
      heading,
      items: group.items.map((item) => ({
        href: `${PLATFORM_BASE}${item.path}`,
        label: navWord(lang, item.label),
        icon: item.icon,
        hint: navWord(lang, item.description),
        words: `${item.label} ${item.description} ${groupWords}`,
      })),
    };
  });
  return (
    <SettingsHub
      title={navWord(lang, section.label)}
      lead={navWord(lang, section.intro ?? "")}
      progress={null}
      groups={groups}
      rest={[]}
      words={{ find: t.find, findPlaceholder: t.findPlaceholder, progressSub: t.progressSub, everythingElse: t.everythingElse, show: t.show, hide: t.hide, everythingElseSub: countWords(0, t.everythingElseSub) }}
    />
  );
}
