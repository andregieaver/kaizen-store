import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
