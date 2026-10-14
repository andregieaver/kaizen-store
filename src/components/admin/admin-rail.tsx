"use client";

import Link from "next/link";

import { NavIcon } from "./nav-icons";
import { useIsCurrent, type NavItem } from "./store-admin-nav";

/**
 * The rail (docs/admin-style.md 5.3, layout `rail`): the level's sections as 44 px icon tiles on the darkest surface, the logo at the
 * top and the items marked `foot` (Settings) at the bottom. The section being viewed is the brand's tile; each tile is named for
 * screen readers and shows its name beside it under the pointer or the keyboard. Only from `md` up: a phone has the slide-out menu.
 */
export function AdminRail({ items, home, label }: { items: NavItem[]; home: { href: string; label: string }; label: string }) {
  const isCurrent = useIsCurrent();
  const main = items.filter((item) => !item.foot);
  const foot = items.filter((item) => item.foot);
  const tile = (item: NavItem) => {
    const current = isCurrent(item);
    const waiting = item.badge ? `, ${item.badge} waiting` : "";
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-label={`${item.label}${waiting}`}
          aria-current={current ? "page" : undefined}
          className="group relative flex size-11 items-center justify-center rounded-tile text-rail-icon hover:bg-[color-mix(in_srgb,var(--rail),white_8%)] hover:text-[color-mix(in_srgb,var(--rail-icon),white_45%)] aria-[current=page]:bg-brand aria-[current=page]:text-brand-ink"
        >
          {item.icon ? <NavIcon name={item.icon} className="size-5" /> : <span className="text-body-strong">{item.label.slice(0, 1)}</span>}
          {item.badge ? (
            <span aria-hidden className="absolute -top-1 -right-1 min-w-[18px] rounded-pill bg-brand px-1 text-center text-[10px] leading-[18px] font-medium text-brand-ink ring-2 ring-rail tabular-nums">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          ) : null}
          <span
            aria-hidden
            className="pointer-events-none absolute left-full z-50 ml-3 rounded-pill bg-inverse px-2.5 py-1 text-caption whitespace-nowrap text-inverse-ink opacity-0 shadow-[var(--shadow-float)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {item.label}
          </span>
        </Link>
      </li>
    );
  };
  return (
    <div data-admin-rail className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center bg-rail py-5 md:flex">
      <Link href={home.href} aria-label={home.label} className="flex size-10 items-center justify-center rounded-tile bg-brand text-title text-brand-ink">
        <span aria-hidden>K</span>
      </Link>
      <nav aria-label={label} className="mt-8 flex flex-1 flex-col items-center justify-between">
        <ul className="flex flex-col gap-3 [@media(max-height:720px)]:gap-1">{main.map(tile)}</ul>
        {foot.length > 0 && <ul className="mt-3 flex flex-col gap-3">{foot.map(tile)}</ul>}
      </nav>
    </div>
  );
}
