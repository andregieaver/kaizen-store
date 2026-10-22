import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, findPages } from "./admin-map";
import { NAV_NB } from "./admin-messages/nav.nb";
import { PAGES_NB } from "./admin-messages/pages.nb";

const key = (page: { area: string; id: string }) => `${page.area}:${page.id}`;

/** Pages whose English title is another page's navigation label: the B2B company page, not the store's own Company. */
const OTHER_THAN_NAV = new Set(["store:b2b-company"]);

describe("admin pages in Norwegian (D312 A2)", () => {
  it("has a Norwegian title and words for every admin page, and none for a page that is gone", () => {
    const keys = new Set(ADMIN_PAGES.map(key));
    expect(ADMIN_PAGES.map(key).filter((k) => !PAGES_NB[k])).toEqual([]);
    expect(Object.keys(PAGES_NB).filter((k) => !keys.has(k))).toEqual([]);
    for (const [k, nb] of Object.entries(PAGES_NB)) {
      expect(nb.title.trim(), k).not.toBe("");
      expect(nb.keywords.length, k).toBeGreaterThan(0);
      expect(nb.keywords.every((w) => w === w.toLowerCase()), k).toBe(true);
    }
  });

  it("calls a page what the navigation calls it", () => {
    const differ = ADMIN_PAGES.filter((p) => NAV_NB[p.title] && !OTHER_THAN_NAV.has(key(p)) && PAGES_NB[key(p)].title !== NAV_NB[p.title]);
    expect(differ.map((p) => `${key(p)}: ${PAGES_NB[key(p)].title} / ${NAV_NB[p.title]}`)).toEqual([]);
  });

  it("finds pages by Norwegian words", () => {
    expect(findPages("store", "bestillinger", { features: ["shop"] }).map((p) => p.id)).toContain("orders");
    expect(findPages("store", "frakt", { features: ["shop"] }).map((p) => p.id)).toContain("shipping");
    expect(findPages("platform", "merverdiavgift").map((p) => p.id)).toContain("vat");
  });
});
