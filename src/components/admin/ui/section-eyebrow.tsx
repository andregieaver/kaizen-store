"use client";

import { usePathname } from "next/navigation";
import { createContext, use, useMemo, type ReactNode } from "react";

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

/** The level's tabs and sections for the eyebrows of the pages inside it (the frame's own, already sent for the rail and sidebars). */
export function NavHereProvider({ tabs, places, children }: Here & { children: ReactNode }) {
  const here = useMemo(() => ({ tabs, places }), [tabs, places]);
  return <NavHere value={here}>{children}</NavHere>;
}

/** Whether a title already says the section's word, so the eyebrow would only repeat it (the section's own page: Orders, Marketing). */
const repeats = (word: string, title: string | undefined) => title !== undefined && title.trim().toLocaleLowerCase() === word.trim().toLocaleLowerCase();

/**
 * The section's word, in the eyebrow's look: nothing on Home's pages (Home is no section, and its other pages, the AI manager and the setup
 * steps, are tools whose titles say what they are), on a page in no section, where the title is the section's own word, or outside the
 * admin's frame. `title` is the header's title where it is plain text.
 */
export function SectionEyebrow({ title }: { title?: string }) {
  const here = use(NavHere);
  return here ? <SectionWord here={here} title={title} /> : null;
}

function SectionWord({ here, title }: { here: Here; title?: string }) {
  const tab = here.tabs[currentIndex(usePathname(), here.tabs, here.places)];
  if (!tab || tab.home || repeats(tab.label, title)) return null;
  return <span className="text-eyebrow text-muted uppercase">{tab.label}</span>;
}
