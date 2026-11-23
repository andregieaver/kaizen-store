"use client";

import { usePathname } from "next/navigation";
import { createContext, use, type ReactNode } from "react";

import { currentIndex, type NavLink, type NavPlace } from "@/lib/nav-current";

/**
 * Where a page is (code review step 2.2, D873): the section's word above a page's title, which `PageHeader` draws for a page that names
 * no eyebrow of its own. A server component is not told its address (a layout stays mounted across its pages), so the word is found here,
 * in the browser's address, from the level's own menu: `AdminFrame` puts its tabs and sidebars' addresses around the page
 * (`NavHereProvider`), the same objects the rail draws, and the word is the label of the tab the rail marks (`currentIndex()`), in the
 * account's language. Its only imports are React, the router's address and the pure lookup, so the kit's index stays light: this module is
 * the one client part `page-header.tsx` names (`ui.test.ts` holds it so).
 */

/** A level's tab as the eyebrow reads it: the menu's own link, its label in the account's language; `home` marks the level's Home. */
type HereTab = NavLink & { label: string; home?: boolean };
type Here = { tabs: readonly HereTab[]; places: readonly NavPlace[] };

const NavHere = createContext<Here | null>(null);

/**
 * The level's tabs and sections for the eyebrows of the pages inside it (the frame's own, already sent for the rail and sidebars). The frame
 * draws it again only when its own props change, so the value is made on each of those draws.
 */
export function NavHereProvider({ tabs, places, children }: Here & { children: ReactNode }) {
  return <NavHere value={{ tabs, places }}>{children}</NavHere>;
}

/**
 * The section's word, in the eyebrow's look: nothing on Home's pages (Home is no section, and its other pages, the AI manager and the setup
 * steps, are tools whose titles say what they are), on a page in no section, where the title (plain text) already is the section's word (the
 * section's own page: Orders, Marketing), or outside the admin's frame, where the address is not read at all: the page builder's sandbox
 * draws headers outside it, on addresses not known before the request.
 */
export function SectionEyebrow({ title }: { title?: string }) {
  const here = use(NavHere);
  return here ? <SectionWord here={here} title={title} /> : null;
}

function SectionWord({ here, title }: { here: Here; title?: string }) {
  const tab = here.tabs[currentIndex(usePathname(), here.tabs, here.places)];
  return tab && !tab.home && tab.label.toLowerCase() !== title?.toLowerCase() ? <span className="text-eyebrow text-muted uppercase">{tab.label}</span> : null;
}
