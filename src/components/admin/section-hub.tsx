import type { AdminLang } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { PageHeader } from "@/components/admin/ui";

import type { NavIconName } from "./nav-icons";
import { HubCards } from "./section-hub-cards";

type Card = { path: string; label: string; description: string; icon?: NavIconName; advanced?: boolean };

/**
 * A section's first page (D144, D147): a card for each page in its sidebar, with its icon and a line on what it does; under a heading for
 * each group where the section has groups. `base` is the level's address (the platform's unless a store's is given). Its words are the
 * navigation's, written in English and shown in the account's language (`lang`, D312 A2). A card marked `advanced` is left out of the
 * Basic view (D454; a store's pages of cards only, `HubCards`).
 */
export function SectionHub({
  title,
  intro,
  items,
  groups,
  base = PLATFORM_BASE,
  lang = "en",
}: {
  title: string;
  intro: string;
  items?: Card[];
  groups?: { heading: string; items: Card[] }[];
  base?: string;
  lang?: AdminLang;
}) {
  const say = (text: string) => navWord(lang, text);
  const lists = groups ?? [{ heading: "", items: items ?? [] }];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={<>{say(title)}</>} description={<>{say(intro)}</>} />
      <HubCards
        lists={lists.map((list) => ({
          heading: list.heading ? say(list.heading) : "",
          items: list.items.map((item) => ({
            href: `${base}${item.path}`,
            label: say(item.label),
            description: say(item.description),
            ...(item.icon && { icon: item.icon }),
            ...(item.advanced && { advanced: true }),
          })),
        }))}
      />
    </div>
  );
}
