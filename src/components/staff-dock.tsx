"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { Icon, type IconName } from "./icons";

/**
 * Staff's tools on the live site, on phones: one pencil button at the bottom left that opens its tools as a column of icons
 * above it, so the page stays readable under them. On wider screens the tools keep their worded buttons (`BackToAdmin`,
 * `PageEditLink`), which hide on phones.
 *
 * The tools come from more than one part of the page (the layout's *Back to admin*, a page's *Edit text*, *Custom CSS* and
 * *Edit page*), so each part hands its own to this module (`useStaffDockItems`), and one dock draws them all: every part that
 * may be the only one on the page draws a `<StaffDock />`, and only the first one mounted shows. Shoppers never see it: a part
 * hands over nothing until it has worked out, in the browser, that the person is staff.
 */

export type StaffDockItem = {
  key: string;
  /** Read by screen readers and shown as the tool's tooltip; the icon stands alone on the screen. */
  label: string;
  icon: IconName;
  /** Its place in the column, nearest the pencil first. */
  order: number;
  lang?: string;
  /** A link, or a button. */
  href?: string;
  onSelect?: () => void;
  /** A tool that is switched on (editing, the CSS panel open). */
  pressed?: boolean;
};

const sources = new Map<string, StaffDockItem[]>();
const hosts: string[] = [];
const listeners = new Set<() => void>();
let items: StaffDockItem[] = [];
let host: string | null = null;

function changed() {
  items = [...sources.values()].flat().sort((a, b) => a.order - b.order);
  host = hosts[0] ?? null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: StaffDockItem[] = [];

/** Whether a part has handed the dock tools (`SiteCssLink` stands back while the page's own `PageEditLink` has). */
export function useStaffDockHas(source: string): boolean {
  return useSyncExternalStore(subscribe, () => sources.has(source), () => false);
}

/** Hands this part's tools to the dock (none while the person is not staff); they are taken back when the part goes. */
export function useStaffDockItems(source: string, own: StaffDockItem[]) {
  // The tools' handlers are new on every render, so they are handed over after each one; the dock draws again only then.
  useEffect(() => {
    if (own.length === 0 && !sources.has(source)) return;
    if (own.length === 0) sources.delete(source);
    else sources.set(source, own);
    changed();
  });
  useEffect(
    () => () => {
      if (sources.delete(source)) changed();
    },
    [source],
  );
}

/** The pencil and its tools; drawn by each part that may be alone on the page, shown once. */
export function StaffDock({ label = "Edit tools", closeLabel = "Close", lang = "en" }: { label?: string; closeLabel?: string; lang?: string }) {
  const id = useId();
  const menuId = `${id}-tools`;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hosts.push(id);
    changed();
    return () => {
      hosts.splice(hosts.indexOf(id), 1);
      changed();
    };
  }, [id]);
  const shown = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const mine = useSyncExternalStore(subscribe, () => host === id, () => false);
  // Escape or a tap anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  if (!mine || shown.length === 0) return null;
  const busy = shown.some((item) => item.pressed);
  const tool = (pressed?: boolean) =>
    `flex size-12 items-center justify-center rounded-full border-2 border-foreground shadow-lg ${pressed ? "bg-foreground text-background" : "bg-background text-foreground"}`;
  return (
    <div
      ref={wrap}
      lang={lang}
      // Staff's tools, not the page's content (the theme switch e2e leaves them out).
      data-staff-tools=""
      data-staff-dock=""
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-50 flex flex-col-reverse items-start gap-3 md:hidden print:hidden"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? closeLabel : label}
        title={open ? closeLabel : label}
        onClick={() => setOpen((was) => !was)}
        // While a tool is on (editing, the CSS panel) the pencil says so: drawn the other way round.
        className={`flex size-14 items-center justify-center rounded-full shadow-lg ${busy && !open ? "border-2 border-foreground bg-background text-foreground" : "bg-foreground text-background"}`}
      >
        <Icon name={open ? "close" : "pencil"} />
      </button>
      <ul id={menuId} hidden={!open} className="flex flex-col-reverse items-start gap-3 pl-1">
        {shown.map((item) => (
          <li key={item.key} lang={item.lang}>
            {item.href ? (
              <a href={item.href} aria-label={item.label} title={item.label} className={tool(item.pressed)}>
                <Icon name={item.icon} />
              </a>
            ) : (
              <button
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={item.pressed}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={tool(item.pressed)}
              >
                <Icon name={item.icon} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
