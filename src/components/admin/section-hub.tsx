import Link from "next/link";

import { PLATFORM_BASE } from "@/lib/platform-nav";
import { PageHeader } from "@/components/admin/ui";

type Card = { path: string; label: string; description: string };

/**
 * A section's first page (D144, D147): a card for each page in its sidebar, with a line on what it does; under a heading for
 * each group where the section has groups. `base` is the level's address (the platform's unless a store's is given).
 */
export function SectionHub({
  title,
  intro,
  items,
  groups,
  base = PLATFORM_BASE,
}: {
  title: string;
  intro: string;
  items?: Card[];
  groups?: { heading: string; items: Card[] }[];
  base?: string;
}) {
  const lists = groups ?? [{ heading: "", items: items ?? [] }];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={<>{title}</>} description={<>{intro}</>} />
      {lists.map((list) => (
        <section key={list.heading} aria-label={list.heading || undefined} className="flex flex-col gap-3">
          {list.heading && <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{list.heading}</h2>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.items.map((item) => (
              <li key={item.path}>
                <Link href={`${base}${item.path}`} className="flex h-full flex-col gap-1 rounded-lg border border-edge bg-card p-4 hover:bg-sunken">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-sm text-muted">{item.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
