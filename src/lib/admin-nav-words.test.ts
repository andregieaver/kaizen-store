import { describe, expect, it } from "vitest";

import { NAV_NB } from "./admin-messages/nav.nb";
import { navAreasIn, navItemsIn, navWord } from "./admin-nav-words";
import { ACCOUNT_ITEMS, ownerAreas, ownerTabs } from "./owner-nav";
import * as PLATFORM from "./platform-nav";
import { STORE_SECTIONS } from "./store-nav";

/** Every text of the admin's navigation, as written in English. */
function navTexts(): string[] {
  const texts = new Set<string>();
  for (const s of STORE_SECTIONS) {
    texts.add(s.label);
    texts.add(s.intro);
    for (const g of s.groups) {
      texts.add(g.heading);
      for (const i of g.items) texts.add(i.label).add(i.description);
    }
  }
  for (const list of [PLATFORM.WEBSITE_ITEMS, PLATFORM.PLAN_ITEMS, PLATFORM.SUPPORT_ITEMS, PLATFORM.SETTINGS_ITEMS]) for (const i of list) texts.add(i.label).add(i.description);
  for (const t of PLATFORM.platformTabs()) texts.add(t.label);
  for (const intro of Object.values(PLATFORM.PLATFORM_HUB_INTROS)) texts.add(intro);
  for (const i of ACCOUNT_ITEMS) texts.add(i.label).add(i.description);
  for (const t of ownerTabs({ owner: true, work: true, support: true })) texts.add(t.label);
  for (const a of ownerAreas({ owner: true, work: true })) for (const g of a.groups) texts.add(g.heading);
  return [...texts];
}

/** Words that read the same in Norwegian: names and established terms. */
const SAME = new Set(["Design", "Team", "SEO", "Stripe", "WordPress"]);

describe("the admin's navigation in Norwegian (D312 A2)", () => {
  it("has Norwegian for every text of the navigation", () => {
    expect(navTexts().filter((t) => NAV_NB[t] === undefined)).toEqual([]);
  });

  it("writes each in Norwegian, not the English again", () => {
    expect(navTexts().filter((t) => NAV_NB[t] === t && !SAME.has(t))).toEqual([]);
  });

  it("keeps no Norwegian for a text the navigation no longer has", () => {
    const texts = new Set(navTexts());
    expect(Object.keys(NAV_NB).filter((t) => !texts.has(t))).toEqual([]);
  });

  it("shows the navigation in the account's language", () => {
    expect(navWord("nb", "Orders")).toBe("Bestillinger");
    expect(navWord("en", "Orders")).toBe("Orders");
    expect(navWord("nb", "Not in the navigation")).toBe("Not in the navigation");
    expect(navItemsIn("nb", [{ href: "/x", label: "Products" }])).toEqual([{ href: "/x", label: "Produkter" }]);
    expect(navAreasIn("nb", [{ prefixes: [], groups: [{ heading: "Selling", items: [{ href: "/y", label: "Shipping" }] }] }])[0].groups[0]).toEqual({
      heading: "Salg",
      items: [{ href: "/y", label: "Frakt" }],
    });
  });
});
