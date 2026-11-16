"use client";

import { useLinkStatus } from "next/link";
import { AdminLink } from "./ui/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { hiddenIn, shownIn } from "@/lib/admin-view";

import { useAdminText } from "./admin-text";
import { BasicViewHint, useAdminView } from "./admin-view";
import { NavIcon, type NavIconName } from "./nav-icons";

/**
 * The store admin's navigation (D39): the main sections as tabs along the
 * header, and the store's settings grouped in a sidebar (the slide-out menu
 * on phones). The page being viewed, or one inside its section, is marked.
 */

export type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  /** A count to show beside it, such as requests waiting. */
  badge?: number;
  /** An icon before the label (D144). */
  icon?: NavIconName;
  /** Other addresses that are inside this section (a tab whose pages live at addresses of their own); an `exact` one is marked on these too, but not below its own address. */
  also?: string[];
  /** Drawn at the foot of the rail rather than with the others (Settings, docs/admin-style.md 5.3). */
  foot?: boolean;
  /** Left out of the Basic view (D454) unless it is the page being viewed. */
  advanced?: boolean;
};
export type NavGroup = { heading: string; items: NavItem[] };

/** An address is inside `prefix` when it is that address or below it. */
const inside = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Whether a link is the page being viewed, or a section the page is inside. */
export function useIsCurrent() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact ? pathname === item.href || (item.also ?? []).some((prefix) => inside(pathname, prefix)) : [item.href, ...(item.also ?? [])].some((prefix) => inside(pathname, prefix));
}

/**
 * A level's sidebar that depends on the section being viewed (D144): the groups of the first area whose addresses the
 * page is inside, or none (the area has no sidebar). `prefixes` are the area's addresses; `exact` ones match only themselves.
 */
export type NavArea = { prefixes: string[]; exact?: string[]; groups: NavGroup[] };

export function useAreaGroups(areas: NavArea[], fallback: NavGroup[]): NavGroup[] {
  const pathname = usePathname();
  const area = areas.find((a) => (a.exact ?? []).includes(pathname) || a.prefixes.some((prefix) => inside(pathname, prefix)));
  return area ? area.groups : fallback;
}

/**
 * The sidebar of the section being viewed; nothing, not even its room, where the section has none. On a section's page of cards the cards
 * say what Basic leaves out (D454), so the sidebar beside them does not say it again.
 */
export function AreaSidebar({ areas, fallback, label, railed = false }: { areas: NavArea[]; fallback: NavGroup[]; label: string; railed?: boolean }) {
  const groups = useAreaGroups(areas, fallback);
  const pathname = usePathname();
  const onHub = areas.some((a) => (a.exact ?? []).includes(pathname));
  if (groups.length === 0) return null;
  // Beside the rail there is no sticky header above it, so it keeps to the top of the screen.
  return (
    <aside className={`hidden w-52 shrink-0 lg:block ${railed ? "pt-2 pb-8" : "py-8"}`}>
      <div className={`sticky ${railed ? "top-6" : "top-32"}`}>
        <StoreSidebar groups={groups} label={label} hint={!onHub} />
      </div>
    </aside>
  );
}

/**
 * The section's pages as a row in the top bar, for a tool drawn in the `workspace` layout (docs/admin-style.md 6.3), which has no
 * room for the sidebar beside it: the support inbox's Requests, Reports, Saved replies and Settings. From `lg` up; the slide-out menu
 * has them on smaller screens.
 */
export function AreaLinks({ areas, fallback, label }: { areas: NavArea[]; fallback: NavGroup[]; label: string }) {
  const isCurrent = useIsCurrent();
  const { view } = useAdminView();
  const items = useAreaGroups(areas, fallback)
    .flatMap((group) => group.items)
    .filter((item) => shownIn(view, item, isCurrent(item)));
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="hidden min-w-0 overflow-x-auto [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <AdminLink
              href={item.href}
              aria-current={isCurrent(item) ? "page" : undefined}
              className="relative flex h-9 items-center rounded-pill px-3 text-body text-ink-2 hover:bg-card hover:text-ink aria-[current=page]:bg-card aria-[current=page]:text-body-strong aria-[current=page]:text-ink"
            >
              {item.icon && <NavIcon name={item.icon} className="mr-1.5 size-4" />}
              {item.label}
              <Badge count={item.badge} />
              <LinkPending />
            </AdminLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The slide-out menu on phones: the tabs, and the sidebar of the section being viewed. */
export function AreaMenu({ tabs, areas, fallback, label, footer }: { tabs: NavItem[]; areas: NavArea[]; fallback: NavGroup[]; label: string; footer?: ReactNode }) {
  const groups = useAreaGroups(areas, fallback);
  const sections = useAdminText("shell").frame.sections;
  return (
    <>
      <StoreSidebar groups={[...(tabs.length > 0 ? [{ heading: sections, items: tabs }] : []), ...groups]} label={label} />
      {footer}
    </>
  );
}

/** The main sections, as tabs under the store's name; they scroll sideways on narrow screens. */
export function StoreTabs({ items, label }: { items: NavItem[]; label: string }) {
  const isCurrent = useIsCurrent();
  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <AdminLink
              href={item.href}
              aria-current={isCurrent(item) ? "page" : undefined}
              className="relative flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-ink"
            >
              {item.icon && <NavIcon name={item.icon} className="mr-1.5 size-4" />}
              {item.label}
              <Badge count={item.badge} />
              <LinkPending />
            </AdminLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * That a pressed link is on its way (code review FS1): a thin bar along the link's foot while its page loads, always drawn and only
 * shown, so nothing moves. The page's own outline (`loading.tsx`) follows once the address changes; this answers the press itself, for
 * a page that was not fetched ahead. Its link is `relative`. `data-pending` is for the tests.
 */
export function LinkPending({ className = "inset-x-3 bottom-1" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className={`pointer-events-none absolute h-0.5 rounded-pill bg-brand opacity-0 transition-opacity delay-100 data-pending:opacity-100 motion-safe:data-pending:animate-pulse ${className}`}
    />
  );
}

/**
 * The phone's bottom bar (admin redesign round 1): under `md`, where the rail is not drawn, the level's first four sections sit at the foot
 * of the screen within a thumb's reach, each an icon over its name, and More opens the slide-out menu with everything else. It is drawn by
 * the frame in the `rail` layout only, and not in the `focus` layout.
 */
export function PhoneTabBar({ items, label, more }: { items: NavItem[]; label: string; more: string }) {
  const isCurrent = useIsCurrent();
  const shown = items.filter((item) => !item.foot).slice(0, 4);
  return (
    <nav
      aria-label={label}
      data-phone-tabs
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-[20px] bg-rail px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {shown.map((item) => (
          <li key={item.href}>
            <AdminLink
              href={item.href}
              aria-current={isCurrent(item) ? "page" : undefined}
              className="relative flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] text-rail-icon aria-[current=page]:text-brand"
            >
              {item.icon && <NavIcon name={item.icon} className="size-[22px]" />}
              <span className="max-w-full truncate px-1">{item.label}</span>
              {item.badge ? (
                <span className="absolute top-0 right-[calc(50%-22px)] min-w-[18px] rounded-pill bg-brand px-1 text-center text-[10px] leading-[18px] text-brand-ink tabular-nums">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </AdminLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            data-open-menu
            aria-haspopup="dialog"
            className="flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[11px] text-rail-icon"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {more}
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** A small count beside a link's label. */
function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-xs leading-none text-brand-ink" aria-label={`${count} waiting`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The store's settings in groups, each under its heading. In the Basic view (D454) the links marked `advanced` are left out, but for the
 * page being viewed; a group with none left is not drawn, and the foot says how many more Advanced has, with the switch to it.
 */
export function StoreSidebar({ groups, label, hint = true }: { groups: NavGroup[]; label: string; hint?: boolean }) {
  const isCurrent = useIsCurrent();
  const { view } = useAdminView();
  const shown = groups.map((group) => ({ ...group, items: group.items.filter((item) => shownIn(view, item, isCurrent(item))) })).filter((group) => group.items.length > 0);
  const hidden = hiddenIn(
    view,
    groups.flatMap((group) => group.items),
    isCurrent,
  );
  return (
    <nav aria-label={label} className="flex flex-col gap-6">
      {shown.map((group) => (
        <div key={group.heading}>
          <h2 className="mb-1 px-3 text-xs tracking-wide text-muted uppercase text-title text-ink">{group.heading}</h2>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <AdminLink
                  href={item.href}
                  aria-current={isCurrent(item) ? "page" : undefined}
                  className="relative flex min-h-10 items-center rounded-pill px-3 text-sm hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:font-medium"
                >
                  {item.icon && <NavIcon name={item.icon} className="mr-2 size-4 text-ink-2" />}
                  {item.label}
                  <Badge count={item.badge} />
                  <LinkPending />
                </AdminLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hint && hidden > 0 && <BasicViewHint hidden={hidden} />}
    </nav>
  );
}
