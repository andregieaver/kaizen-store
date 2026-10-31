import { describe, expect, it } from "vitest";

import { pageName, parseRecent, rememberPage } from "./recent-pages";

describe("the AI manager panel's recent pages (PSI UX-06)", () => {
  it("puts the newest first, moves a page seen before and keeps five", () => {
    let list = rememberPage([], { path: "/admin/s/orders", title: "Orders" });
    list = rememberPage(list, { path: "/admin/s/products", title: "Products" });
    list = rememberPage(list, { path: "/admin/s/orders", title: "Orders" });
    expect(list.map((p) => p.path)).toEqual(["/admin/s/orders", "/admin/s/products"]);
    for (let i = 0; i < 9; i += 1) list = rememberPage(list, { path: `/admin/s/p${i}`, title: `P${i}` });
    expect(list).toHaveLength(5);
    expect(rememberPage(list, { path: "/admin/s/x", title: "" })).toEqual(list);
  });

  it("names a page by its title without the admin's suffix, and trusts only stored entries of the right shape", () => {
    expect(pageName("Orders · Kaizena Flow admin")).toBe("Orders");
    expect(parseRecent('[{"path":"/admin/s","title":"Home"},{"path":"https://elsewhere.example","title":"X"},{"title":"No path"}]')).toEqual([
      { path: "/admin/s", title: "Home" },
    ]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });
});
