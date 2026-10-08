"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A choice of language or currency (D109): each is a link to the page the
 * shopper is on, in the market address that chooses it, so the choice is in
 * the address like the country is. Links lead to the country's front page
 * where JavaScript is off.
 */
export type ViewItem = {
  key: string;
  label: string;
  /** The market address of the choice (`no-en`), the key it is known by. */
  slug: string;
  /** Its front page as a path before the rest of an address (`marketPath()`): empty for a store's own host's front page (D181). */
  base: string;
  current: boolean;
  lang?: string;
};

export function ViewMenu({
  icon,
  summary,
  srLabel,
  items,
  here,
  className,
  list = false,
}: {
  icon: ReactNode;
  summary: string;
  srLabel: string;
  items: ViewItem[];
  /** The current view's front page as a path before the rest of an address (`marketPath()` of it; empty on a store's own host when it has no country in its addresses, D181). */
  here: string;
  className?: string;
  /** Shown as a row of links rather than a menu (the footer, the phone menu). */
  list?: boolean;
}) {
  const router = useRouter();
  // Read when a link is chosen, not while rendering, so pages stay prerendered.
  const hrefFor = (base: string) => {
    const path = window.location.pathname;
    const rest = here === "" ? (path === "/" ? "" : path) : path === here || path.startsWith(`${here}/`) ? path.slice(here.length) : "";
    return `${base}${rest}` || "/";
  };
  const link = (item: ViewItem, classes: string) => (
    <Link
      href={item.base || "/"}
      lang={item.lang}
      hrefLang={item.lang}
      aria-current={item.current ? "true" : undefined}
      className={classes}
      onClick={(event) => {
        // The page the shopper is on, in the choice made, with what is asked of it kept.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.push(`${hrefFor(item.base)}${window.location.search}${window.location.hash}`);
      }}
    >
      {item.label}
    </Link>
  );
  if (list) {
    return (
      <nav aria-label={srLabel} className={className}>
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.key}>{link(item, "flex min-h-11 items-center rounded-button border border-border px-4 text-sm aria-[current=true]:border-foreground aria-[current=true]:font-semibold")}</li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <details className={`group relative ${className ?? ""}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-button px-3 text-sm hover:bg-current/5 [&::-webkit-details-marker]:hidden">
        {icon}
        {summary}
        <span className="sr-only">· {srLabel}</span>
      </summary>
      <ul className="absolute right-0 z-10 mt-2 min-w-40 rounded-lg border border-border bg-background p-1 text-foreground shadow-lg">
        {items.map((item) => (
          <li key={item.key}>{link(item, "block rounded-md px-3 py-2 text-sm hover:bg-surface aria-[current=true]:font-semibold")}</li>
        ))}
      </ul>
    </details>
  );
}
