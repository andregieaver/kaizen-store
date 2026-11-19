import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./policy-link", () => ({
  PolicyLink: (props: { policy: string; href: string; className?: string; children?: unknown }) =>
    h("a", { "data-policy": props.policy, href: props.href }, props.children as never),
}));

import { MenuTreeView, type MenuLinkNode } from "./menu-view";

/**
 * A menu with a hover or active effect (D207) draws `MenuGlide`, which reads the address with `usePathname()`. On a prerendered page (a
 * store's front page, `cacheComponents`) a client hook that reads the address outside a `<Suspense>` boundary stops the page prerendering,
 * which fails the build for any store whose header uses such a menu (found with Orbit's header, `docs/signature-themes.md`).
 */
describe("the menu's active marker", () => {
  it("is drawn inside a Suspense boundary on the site", () => {
    const source = readFileSync(path.join(__dirname, "menu-view.tsx"), "utf8");
    const uses = [...source.matchAll(/<MenuGlide\b/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const before = source.slice(0, use.index);
      expect(before.lastIndexOf("<Suspense")).toBeGreaterThan(before.lastIndexOf("</Suspense>"));
    }
  });
});

/** What a menu's links may fetch ahead (bloat review step 2.6, `docs/performance.md`): a header's top links on sight, everything else on intent. */
describe("a menu's prefetch policies", () => {
  const leaf = (key: string, children: MenuLinkNode[] = [], mega?: MenuLinkNode["mega"]): MenuLinkNode => ({
    key,
    href: `/${key}`,
    text: key,
    external: false,
    newTab: false,
    children,
    mega,
  });
  const nodes = [
    leaf("drop", [leaf("drop-a", [leaf("drop-a1")]), leaf("drop-b")]),
    leaf("big", [leaf("big-a", [leaf("big-a1")])], { columns: 2, center: false }),
    leaf("plain"),
  ];
  const policies = (layout: "row" | "column" | "drawer") => {
    const html = renderToStaticMarkup(h(MenuTreeView, { nodes, layout, linkClassName: "x", newTabLabel: "", subLinksLabel: "" }));
    return Object.fromEntries([...html.matchAll(/<a data-policy="(\w+)" href="\/([\w-]+)"/g)].map((m) => [m[2], m[1]]));
  };

  it("draws a row's top links on sight and every link under them on intent", () => {
    expect(policies("row")).toEqual({
      drop: "sight",
      "drop-a": "intent",
      "drop-a1": "intent",
      "drop-b": "intent",
      big: "sight",
      "big-a": "intent",
      "big-a1": "intent",
      plain: "sight",
    });
  });

  it("draws a column and the phone's menu on intent only", () => {
    for (const layout of ["column", "drawer"] as const) {
      const found = policies(layout);
      expect(Object.keys(found).length, layout).toBe(8);
      expect(new Set(Object.values(found)), layout).toEqual(new Set(["intent"]));
    }
  });
});
