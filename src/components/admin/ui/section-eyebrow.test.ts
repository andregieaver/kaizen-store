import { createElement as h, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

import { ADMIN_PAGES } from "@/lib/admin-map";
import type { AdminLang } from "@/lib/admin-lang";
import { navAreasIn, navItemsIn, navWord } from "@/lib/admin-nav-words";
import { OWNER_BASE, ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { PLATFORM_BASE, platformAreas, platformTabs } from "@/lib/platform-nav";
import { FEATURE_IDS } from "@/lib/store-features";
import { sectionOf, storeNav } from "@/lib/store-nav";
import { WORK_ROOT } from "@/lib/work-paths";

import { PageHeader } from "./page-header";
import { NavHereProvider } from "./section-eyebrow";

/**
 * Say where you are (code review step 2.2, D873): a page's header names its section above the title, worked out from the address and the
 * level's own menu as the frame hands it down (`NavHereProvider`), in the account's language, at all three levels.
 */
type Menu = { tabs: ComponentProps<typeof NavHereProvider>["tabs"]; places: ComponentProps<typeof NavHereProvider>["places"] };
const STORE = "/admin/s";
const store = storeNav(STORE, [...FEATURE_IDS]);
const who = { owner: true, work: true, support: true, domains: true, books: true };
/** A level's menu as `AdminFrame` hands it: the tabs and sidebars in the account's language. */
const menus = (lang: AdminLang): Record<"store" | "platform" | "owner", Menu> => ({
  store: { tabs: navItemsIn(lang, store.tabs), places: navAreasIn(lang, store.areas) },
  platform: { tabs: navItemsIn(lang, platformTabs()), places: navAreasIn(lang, platformAreas()) },
  owner: { tabs: navItemsIn(lang, ownerTabs(who)), places: navAreasIn(lang, ownerAreas(who)) },
});

const header = (at: string, menu: Menu | null, props: ComponentProps<typeof PageHeader> = { title: "A page" }) => {
  path.current = at;
  const page = h(PageHeader, props);
  return renderToStaticMarkup(menu ? h(NavHereProvider, { ...menu, children: page }) : page).replace(/&amp;/g, "&");
};
const eyebrow = (markup: string) => markup.match(/<span class="text-eyebrow text-muted uppercase">([^<]*)<\/span>/)?.[1];
const filled = (p: string) => p.replace(/\[[A-Za-z]+\]/g, "x1");

describe("the section above a page's title", () => {
  it.each(["en", "nb"] as const)("names the section of every store page, as sectionOf() and the menu's words have it (%s), and none on Home's", (lang) => {
    const menu = menus(lang).store;
    const wrong: string[] = [];
    for (const page of ADMIN_PAGES.filter((p) => p.area === "store")) {
      const p = filled(page.path);
      const section = sectionOf(p);
      const want = section ? navWord(lang, section.label) : undefined;
      const got = eyebrow(header(`${STORE}${p}`, menu));
      if (got !== want) wrong.push(`${p}: ${got} (${want})`);
    }
    expect(wrong).toEqual([]);
    expect(eyebrow(header(`${STORE}/analytics`, menu, { title: "Overview" }))).toBe(lang === "nb" ? "Analyse" : "Analytics");
    expect(eyebrow(header(`${STORE}/orders/drafts`, menu))).toBe(lang === "nb" ? "Bestillinger" : "Orders");
    expect(eyebrow(header(STORE, menu))).toBeUndefined();
    expect(eyebrow(header(`${STORE}/assistant`, menu))).toBeUndefined();
  });

  it("names the platform's section of every page in one, in the account's language; none on Home and the AI manager", () => {
    for (const lang of ["en", "nb"] as const) {
      const menu = menus(lang).platform;
      const without = ADMIN_PAGES.filter((p) => p.area === "platform")
        .map((p) => filled(p.path))
        .filter((p) => eyebrow(header(`${PLATFORM_BASE}${p}`, menu)) === undefined);
      expect(without.filter((p) => p !== "" && !p.startsWith("/assistant"))).toEqual([]);
      expect(eyebrow(header(`${PLATFORM_BASE}/plans/limits`, menu))).toBe(navWord(lang, "Plans"));
      expect(eyebrow(header(`${PLATFORM_BASE}/docs/feedback`, menu))).toBe(navWord(lang, "Website"));
    }
  });

  it("names the owner's level's section: Account, Stores, Work; none on the control center", () => {
    const menu = menus("nb").owner;
    expect(eyebrow(header(`${OWNER_BASE}/account/appearance`, menu))).toBe("Konto");
    expect(eyebrow(header(`${OWNER_BASE}/stores`, menu))).toBe("Butikker");
    expect(eyebrow(header(`${WORK_ROOT}/clients`, menu))).toBe("Arbeid");
    expect(eyebrow(header(OWNER_BASE, menu))).toBeUndefined();
  });

  it("is left out where the title or the way back already says the section's word, and its empty line folds away", () => {
    const menu = menus("en").store;
    const out = header(`${STORE}/orders`, menu, { title: "Orders" });
    expect(eyebrow(out)).toBeUndefined();
    expect(out).toContain('<div class="mb-2 flex flex-wrap items-center gap-3 empty:hidden"></div>');
    expect(eyebrow(header(`${STORE}/marketing`, menu, { title: "Marketing" }))).toBeUndefined();
    // Draft orders leads back to Orders: the way back names the section already.
    expect(eyebrow(header(`${STORE}/orders/drafts`, menu, { title: "Draft orders", back: { href: `${STORE}/orders`, label: "Orders" } }))).toBeUndefined();
    // A way back to a record says where it leads, not the section.
    expect(eyebrow(header(`${STORE}/customers/x1/notes`, menu, { title: "Notes", back: { href: `${STORE}/customers/x1`, label: "Alderney Ceramics" } }))).toBe("Customers");
  });

  it("keeps a page's own eyebrow, draws none for eyebrow={false} or a sample header, and none outside the admin's frame", () => {
    const menu = menus("en").store;
    expect(eyebrow(header(`${STORE}/customers/x1`, menu, { title: "Alderney Ceramics", eyebrow: "Company" }))).toBe("Company");
    expect(eyebrow(header(`${STORE}/customers/x1`, menu, { title: "Alderney Ceramics", eyebrow: false }))).toBeUndefined();
    expect(eyebrow(header(`${STORE}/customers/x1`, menu, { title: "Preview", as: "p" }))).toBeUndefined();
    expect(eyebrow(header(`${STORE}/customers/x1`, null))).toBeUndefined();
    // Beside a status chip, on the same line.
    const out = header(`${STORE}/orders/x1`, menu, { title: "#1001", status: h("span", { className: "chip" }, "Paid") });
    expect(out).toMatch(/<div class="mb-2 flex flex-wrap items-center gap-3 empty:hidden"><span class="text-eyebrow text-muted uppercase">Orders<\/span><span class="chip">Paid<\/span><\/div>/);
  });
});
