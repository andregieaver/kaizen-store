import Link from "next/link";

import type { AdminLang } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { PageHeader } from "@/components/admin/ui";

type Card = { path: string; label: string; description: string };

/**
 * A section's first page (D144, D147): a card for each page in its sidebar, with a line on what it does; under a heading for
 * each group where the section has groups. `base` is the level's address (the platform's unless a store's is given). Its words are the
 * navigation's, written in English and shown in the account's language (`lang`, D312 A2).
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
      {lists.map((list) => (
        <section key={list.heading} aria-label={list.heading ? say(list.heading) : undefined} className="flex flex-col gap-3">
          {list.heading && <h2 className="text-xs tracking-wide text-muted uppercase text-title text-ink">{say(list.heading)}</h2>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.items.map((item) => (
              <li key={item.path}>
                <Link href={`${base}${item.path}`} className="flex h-full flex-col gap-1 rounded-lg border border-edge bg-card p-4 hover:bg-sunken">
                  <span className="font-medium">{say(item.label)}</span>
                  <span className="text-sm text-muted">{say(item.description)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
