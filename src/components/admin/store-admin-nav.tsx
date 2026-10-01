"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
  /** Other addresses that are inside this section (a tab whose pages live at addresses of their own). */
  also?: string[];
};
export type NavGroup = { heading: string; items: NavItem[] };

/** An address is inside `prefix` when it is that address or below it. */
const inside = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

function useIsCurrent() {
  const pathname = usePathname();
  return (item: NavItem) => (item.exact ? pathname === item.href : [item.href, ...(item.also ?? [])].some((prefix) => inside(pathname, prefix)));
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

/** The sidebar of the section being viewed; nothing, not even its room, where the section has none. */
export function AreaSidebar({ areas, fallback, label }: { areas: NavArea[]; fallback: NavGroup[]; label: string }) {
  const groups = useAreaGroups(areas, fallback);
  if (groups.length === 0) return null;
  return (
    <aside className="hidden w-52 shrink-0 py-8 lg:block">
      <div className="sticky top-32">
        <StoreSidebar groups={groups} label={label} />
      </div>
    </aside>
  );
}

/** The slide-out menu on phones: the tabs, and the sidebar of the section being viewed. */
export function AreaMenu({ tabs, areas, fallback, label, footer }: { tabs: NavItem[]; areas: NavArea[]; fallback: NavGroup[]; label: string; footer?: ReactNode }) {
  const groups = useAreaGroups(areas, fallback);
  return (
    <>
      <StoreSidebar groups={[...(tabs.length > 0 ? [{ heading: "Sections", items: tabs }] : []), ...groups]} label={label} />
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
            <Link
              href={item.href}
              aria-current={isCurrent(item) ? "page" : undefined}
              className="flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-muted hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {item.icon && <NavIcon name={item.icon} className="mr-1.5 size-4" />}
              {item.label}
              <Badge count={item.badge} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A small count beside a link's label. */
function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-xs leading-none text-background" aria-label={`${count} waiting`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The store's settings in groups, each under its heading. */
export function StoreSidebar({ groups, label }: { groups: NavGroup[]; label: string }) {
  const isCurrent = useIsCurrent();
  return (
    <nav aria-label={label} className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.heading}>
          <h2 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">{group.heading}</h2>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item) ? "page" : undefined}
                  className="flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium"
                >
                  {item.icon && <NavIcon name={item.icon} className="mr-2 size-4" />}
                  {item.label}
                  <Badge count={item.badge} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
