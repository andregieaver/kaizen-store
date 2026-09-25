"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The store admin's navigation (D39): the main sections as tabs along the
 * header, and the store's settings grouped in a sidebar (the slide-out menu
 * on phones). The page being viewed, or one inside its section, is marked.
 */

export type NavItem = { href: string; label: string; exact?: boolean };
export type NavGroup = { heading: string; items: NavItem[] };

function useIsCurrent() {
  const pathname = usePathname();
  return (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
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
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
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
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Admin areas that are not a store; any other first segment is a store's slug. */
const NOT_STORES = new Set(["platform", "account", "stores"]);

/** Shows its children except in a store's admin, which has a header of its own. */
export function OutsideStoreAdmin({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const inStore = segment !== null && !segment.startsWith("__") && !NOT_STORES.has(segment);
  return inStore ? null : children;
}
