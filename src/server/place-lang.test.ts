import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/menus", () => ({ storeSlugOf: async (id: string) => (id === "house" ? "kaizenaflow" : null) }));
vi.mock("@/server/stores", () => ({ getOpenStore: async (slug: string) => (slug === "kaizenaflow" ? { slug, markets: [] } : null) }));
vi.mock("@/server/shop", () => ({ marketIn: (_store: unknown, market: string | null) => (market === "no-nb" ? { lang: "nb" } : market === "no" ? { lang: "en" } : undefined) }));

const { sitePlaceLang } = await import("./place-lang");

describe("the language of Kaizena Flow's own parts at their place (D312, D484)", () => {
  it("is Kaizena Flow's own page's, English unless said", async () => {
    expect(await sitePlaceLang({ owner: null, pageId: null, lang: "nb" })).toBe("nb");
    expect(await sitePlaceLang({ owner: null, pageId: null })).toBe("en");
  });

  it("is its own store's market's while the store serves the site, whose pages say no language", async () => {
    expect(await sitePlaceLang({ owner: "house", pageId: "p", market: "no-nb" })).toBe("nb");
    expect(await sitePlaceLang({ owner: "house", pageId: "p", market: "no" })).toBe("en");
    // A market in a language Kaizena Flow's site does not have, or none: English.
    expect(await sitePlaceLang({ owner: "other", pageId: "p", market: "se" })).toBe("en");
  });
});
