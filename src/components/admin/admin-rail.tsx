"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { RAIL_NAMES_EVENT, railNamesShown, setRailNames } from "@/lib/admin-rail";

import { NavIcon } from "./nav-icons";
import { useIsCurrent, type NavItem } from "./store-admin-nav";

/** Whether the rail shows its names (`<html data-rail="names">`, D262), followed as it changes; none on the server. */
function useRailNames(): boolean {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener(RAIL_NAMES_EVENT, changed);
      return () => window.removeEventListener(RAIL_NAMES_EVENT, changed);
    },
    railNamesShown,
    () => false,
  );
}

/**
 * The rail (docs/admin-style.md 5.3, layout `rail`): the level's sections as 44 px icon tiles on the darkest surface, the logo at the
 * top and the items marked `foot` (Settings) at the bottom. The section being viewed is the brand's tile; each tile is named for
 * screen readers and shows its name beside it under the pointer or the keyboard. Only from `md` up: a phone has the slide-out menu.
 * On a page of the `workspace` layout (`collapseOn`, a regular expression's source) it narrows to 64 px, so a tool has the room.
 * The button at its foot widens it to show every section's name beside its icon (D262), a choice kept in the browser and set on
 * `<html>` before the page is drawn (`railNamesScript()`), which the classes follow; a workspace's narrow rail keeps to its icons.
 */
export function AdminRail({ items, home, label, collapseOn }: { items: NavItem[]; home: { href: string; label: string }; label: string; collapseOn?: string }) {
  const isCurrent = useIsCurrent();
  const path = usePathname();
  const named = useRailNames();
  const collapsed = Boolean(collapseOn) && new RegExp(collapseOn as string).test(path);
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
          className={`group relative flex ${collapsed ? "size-10" : "size-11 [[data-rail=names]_&]:w-full [[data-rail=names]_&]:justify-start [[data-rail=names]_&]:gap-3 [[data-rail=names]_&]:px-3"} items-center justify-center rounded-tile text-rail-icon hover:bg-[color-mix(in_srgb,var(--rail),white_8%)] hover:text-[color-mix(in_srgb,var(--rail-icon),white_45%)] aria-[current=page]:bg-brand aria-[current=page]:text-brand-ink`}
        >
          {item.icon ? <NavIcon name={item.icon} className="size-5 shrink-0" /> : <span className="text-body-strong">{item.label.slice(0, 1)}</span>}
          {!collapsed && (
            <span aria-hidden className="hidden truncate text-body-strong [[data-rail=names]_&]:inline">
              {item.label}
            </span>
          )}
          {item.badge ? (
            <span
              aria-hidden
              className={`absolute -top-1 -right-1 min-w-[18px] rounded-pill bg-brand px-1 text-center text-[10px] leading-[18px] font-medium text-brand-ink ring-2 ring-rail tabular-nums ${collapsed ? "" : "[[data-rail=names]_&]:static [[data-rail=names]_&]:ml-auto"}`}
            >
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          ) : null}
          <span
            aria-hidden
            className={`pointer-events-none absolute left-full z-50 ml-3 rounded-pill bg-inverse px-2.5 py-1 text-caption whitespace-nowrap text-inverse-ink opacity-0 shadow-[var(--shadow-float)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${collapsed ? "" : "[[data-rail=names]_&]:hidden"}`}
          >
            {item.label}
          </span>
        </Link>
      </li>
    );
  };
  const Toggle = named ? PanelLeftClose : PanelLeftOpen;
  // Named for what it does to the sidebar: a name with "name" in it would answer every search for a Name field.
  const toggleLabel = named ? "Narrow the sidebar" : "Widen the sidebar";
  return (
    <div
      data-admin-rail
      data-collapsed={collapsed ? "" : undefined}
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col items-center bg-rail md:flex ${collapsed ? "w-16 py-4" : "w-20 py-5 [[data-rail=names]_&]:w-56 [[data-rail=names]_&]:items-stretch [[data-rail=names]_&]:px-3"}`}
    >
      <Link href={home.href} aria-label={home.label} className="flex size-10 items-center justify-center rounded-tile bg-brand text-title text-brand-ink">
        <span aria-hidden>K</span>
      </Link>
      <nav aria-label={label} className={`mt-8 flex flex-1 flex-col items-center justify-between ${collapsed ? "" : "[[data-rail=names]_&]:items-stretch"}`}>
        <ul className={`flex flex-col ${collapsed ? "gap-2" : "gap-3"} [@media(max-height:720px)]:gap-1`}>{main.map(tile)}</ul>
        {foot.length > 0 && <ul className="mt-3 flex flex-col gap-3">{foot.map(tile)}</ul>}
      </nav>
      {!collapsed && (
        <button
          type="button"
          onClick={() => setRailNames(!named)}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="mt-3 flex size-11 items-center justify-center gap-3 rounded-tile text-rail-icon hover:bg-[color-mix(in_srgb,var(--rail),white_8%)] hover:text-[color-mix(in_srgb,var(--rail-icon),white_45%)] [[data-rail=names]_&]:w-full [[data-rail=names]_&]:justify-start [[data-rail=names]_&]:px-3"
        >
          <Toggle aria-hidden className="size-5 shrink-0" />
          <span aria-hidden className="hidden text-caption [[data-rail=names]_&]:inline">
            Narrow
          </span>
        </button>
      )}
    </div>
  );
}
