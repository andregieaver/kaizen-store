import { describe, expect, it } from "vitest";

import type { PageContent } from "./page-content";
import { pageImageUrls, withLibraryAlts, type LibraryAlt } from "./page-images";
import { localizePage } from "./page-translation";

const picture = (url: string, alt = "") => ({ url, width: 800, height: 600, alt });

function page(blocks: { id: string; url: string; alt?: string }[], thumbnail: string | null = null): PageContent {
  return {
    title: "Om oss",
    slug: "om-oss",
    thumbnail: thumbnail ? picture(thumbnail) : null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [
      {
        id: "r",
        type: "row",
        layout: "1",
        columns: [{ id: "c", blocks: blocks.map((b) => ({ id: b.id, type: "image", image: picture(b.url, b.alt), caption: "" })) }],
      },
    ],
  } as PageContent;
}

const library = new Map<string, LibraryAlt>([
  ["/a.webp", { alt: "En hvit kopp", translations: { "sv-SE": "En vit kopp" } }],
  ["/b.webp", { alt: "En lampe", translations: {} }],
  ["/t.webp", { alt: "Butikken sett utenfra", translations: {} }],
]);

describe("a page's pictures and the library's alt texts (D89)", () => {
  it("lists the page's pictures, its own first", () => {
    expect(pageImageUrls(page([{ id: "x", url: "/a.webp" }, { id: "y", url: "/a.webp" }, { id: "z", url: "/b.webp" }], "/t.webp"))).toEqual([
      "/t.webp",
      "/a.webp",
      "/b.webp",
    ]);
  });

  it("describes pictures without alt texts of their own, in the page's languages", () => {
    const content = page([{ id: "x", url: "/a.webp" }, { id: "y", url: "/b.webp", alt: "Lampen i vinduet" }, { id: "z", url: "/none.webp" }], "/t.webp");
    const filled = withLibraryAlts(content, (url) => library.get(url));
    const alts = (c: PageContent) => c.rows[0].columns[0].blocks.map((b) => (b.type === "image" ? b.image?.alt : null));
    expect(alts(filled)).toEqual(["En hvit kopp", "Lampen i vinduet", ""]);
    expect(filled.thumbnail?.alt).toBe("Butikken sett utenfra");
    // Swedish reads the library's Swedish; a picture the page describes keeps its words there too.
    expect(alts(localizePage(filled, "sv-SE"))).toEqual(["En vit kopp", "Lampen i vinduet", ""]);
    // Nothing to fill: the page as it was.
    expect(withLibraryAlts(content, () => undefined)).toBe(content);
  });

  it("keeps a translation the page has of its own", () => {
    const content = { ...page([{ id: "x", url: "/a.webp" }]), translations: { "sv-SE": { "block.x.alt": "Min kopp" } } };
    const filled = withLibraryAlts(content, (url) => library.get(url));
    expect(filled.translations?.["sv-SE"]?.["block.x.alt"]).toBe("Min kopp");
  });
});
