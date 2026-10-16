import { describe, expect, it } from "vitest";

import { NO_DEMO, andWords, demoTotal, demoWords, keptWords, linksToRemoved, removalWords, type RemovedAddresses } from "./demo-content";

/** A store's demo content in words, and which menu links go with it (`docs/theme-showcase-phase-1.md` step 4b). */

describe("the demo content's words", () => {
  it("count only what there is, in a fixed order", () => {
    expect(demoWords({ products: 6, pages: 2, articles: 0, categories: 3, tags: 1 })).toBe("6 products, 2 pages, 3 categories and 1 tag");
    expect(demoWords({ ...NO_DEMO, articles: 1 })).toBe("1 article");
    expect(demoWords(NO_DEMO)).toBe("");
    expect(demoTotal({ products: 1, pages: 2, articles: 3, categories: 4, tags: 5 })).toBe(15);
    expect(andWords(["a", "b", "c"])).toBe("a, b and c");
  });

  it("name what stayed, one sentence for each reason", () => {
    expect(
      keptWords([
        { kind: "product", title: "Linen shirt", reason: "changed" },
        { kind: "term", title: "Coats", reason: "in_use" },
        { kind: "page", title: "About us", reason: "changed" },
      ]),
    ).toEqual(["Kept 2 you changed: Linen shirt and About us.", "Kept 1 that your own products or pages use: Coats."]);
    expect(keptWords([])).toEqual([]);
  });

  it("say what went first, and that nothing did when nothing was left", () => {
    expect(removalWords({ ...NO_DEMO, products: 2, pages: 1 }, [{ kind: "page", title: "Spring", reason: "in_test" }])).toEqual([
      "Removed 2 products and 1 page. Products are archived, so past orders keep them.",
      "Kept 1 in an A/B test: Spring.",
    ]);
    expect(removalWords(NO_DEMO, [])).toEqual(["Nothing was removed."]);
  });
});

describe("a menu link to what was removed", () => {
  const gone: RemovedAddresses = {
    products: ["linen-shirt"],
    pages: ["about"],
    articles: ["news"],
    categories: ["coats"],
    tags: ["new"],
    blogCategories: ["stories"],
  };

  it("is found by its own kind's address", () => {
    expect(linksToRemoved({ kind: "product", handle: "linen-shirt" }, gone)).toBe(true);
    expect(linksToRemoved({ kind: "page", slug: "about" }, gone)).toBe(true);
    expect(linksToRemoved({ kind: "article", slug: "news" }, gone)).toBe(true);
    expect(linksToRemoved({ kind: "category", slug: "coats" }, gone)).toBe(true);
    expect(linksToRemoved({ kind: "tag", slug: "new" }, gone)).toBe(true);
    expect(linksToRemoved({ kind: "blogCategory", slug: "stories" }, gone)).toBe(true);
  });

  it("is never one of another kind with the same address, a site link, or a damaged one", () => {
    expect(linksToRemoved({ kind: "page", slug: "news" }, gone)).toBe(false);
    expect(linksToRemoved({ kind: "tag", slug: "coats" }, gone)).toBe(false);
    expect(linksToRemoved({ kind: "product", slug: "linen-shirt" }, gone)).toBe(false);
    expect(linksToRemoved({ kind: "home" }, gone)).toBe(false);
    expect(linksToRemoved({ kind: "url", url: "/p/linen-shirt" }, gone)).toBe(false);
    expect(linksToRemoved(null, gone)).toBe(false);
    expect(linksToRemoved("about", gone)).toBe(false);
  });
});
