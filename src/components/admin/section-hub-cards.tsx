"use client";

import Link from "next/link";

import { hiddenIn, shownIn } from "@/lib/admin-view";

import { BasicViewHint, useAdminView } from "./admin-view";
import { NavIcon, type NavIconName } from "./nav-icons";

export type HubCard = { href: string; label: string; description: string; icon?: NavIconName; advanced?: boolean };
export type HubList = { heading: string; items: HubCard[] };

/**
 * A page of cards' cards (D144, D147), in the words already chosen for the account: an icon, the page's name and its line, under a heading
 * for each group. In the Basic view (D454) the cards marked `advanced` are left out, a group with none left is not drawn, and a note at
 * the foot says how many more Advanced has, with the switch to it.
 */
export function HubCards({ lists }: { lists: HubList[] }) {
  const { view } = useAdminView();
  const hidden = hiddenIn(
    view,
    lists.flatMap((list) => list.items),
  );
  return (
    <>
      {lists.map((list) => {
        const items = list.items.filter((item) => shownIn(view, item, false));
        if (items.length === 0) return null;
        return (
          <section key={list.heading} aria-label={list.heading || undefined} className="flex flex-col gap-3">
            {list.heading && <h2 className="text-xs tracking-wide text-muted uppercase text-title text-ink">{list.heading}</h2>}
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex h-full gap-3 rounded-lg border border-edge bg-card p-4 hover:bg-sunken">
                    {item.icon && (
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-sunken text-ink-2">
                        <NavIcon name={item.icon} className="size-[18px]" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-sm text-muted">{item.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {hidden > 0 && <BasicViewHint hidden={hidden} card />}
    </>
  );
}
