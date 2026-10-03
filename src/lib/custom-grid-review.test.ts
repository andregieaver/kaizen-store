import { describe, expect, it } from "vitest";

import type { GridItem } from "./content-grid";
import { copiedItems, copyLeftOut, customGridData, itemLinkHref, itemsFromGrid, newCustomItem, newDetailLine, sourceChoice } from "./custom-grid";
import { sanitizeTemplate } from "./template-content";
import {
  newPageContent,
  pageInput,
  type ContentGridBlock,
  type CustomGridItem,
  type PageContent,
} from "./page-content";
import { blockTextFields, localizePage, withTranslation } from "./page-translation";
import { newBlock } from "./page-rows";

/**
 * Review findings on custom grid items (D155): each test states what should hold and fails today.
 */

const item = (over: Partial<CustomGridItem> = {}): CustomGridItem => ({
  id: "i1", title: "T", text: "", picture: null, link: null, buttonLabel: "", date: null, badge: "", priceText: "", details: [], ...over,
});
const grid = (items: CustomGridItem[]): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
  source: { type: "custom" },
  limit: 60,
  items,
});
const page = (block: ContentGridBlock): PageContent => ({
  ...newPageContent(),
  title: "P",
  slug: "p",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
});

describe("review: copy current items", () => {
  it("makes items the page can be saved with, also from the demo products, whose pictures are paths on the site (/demo/mug.svg)", () => {
    const shown: GridItem[] = [
      { id: "p1", href: "/s/demo/no/p/demo-mug", title: "Demo: Mug", excerpt: "A mug.", image: { url: "/demo/mug.svg", alt: "A mug" }, price: null },
    ];
    let n = 0;
    const items = itemsFromGrid("products", shown, { newId: () => `id${++n}` });
    const saved = pageInput.safeParse(page(grid(items)));
    expect(saved.success, saved.success ? "" : saved.error.issues.map((i) => i.message).join("; ")).toBe(true);
  });
});

describe("review: translations of detail lines", () => {
  it("do not move to another line when the owner takes a line out", () => {
    const before = page(grid([item({ details: [{ id: "da", label: "A", text: "first" }, { id: "db", label: "B", text: "second" }] })]));
    const translated = withTranslation(before, "sv", {
      "block.g1.i1.detail-da.text": "första",
      "block.g1.i1.detail-db.text": "andra",
    });
    // The owner takes the first line out in the main language; the second line is now the only one.
    const edited: PageContent = {
      ...translated,
      rows: [{ ...translated.rows[0], columns: [{ ...translated.rows[0].columns[0], blocks: [grid([item({ details: [{ id: "db", label: "B", text: "second" }] })])] }] }],
    };
    const shown = localizePage(edited, "sv").rows[0].columns[0].blocks[0] as ContentGridBlock;
    expect(shown.items?.[0].details[0].text).not.toBe("första");
    // It is the line's own translation that stays with it.
    expect(shown.items?.[0].details[0].text).toBe("andra");
  });

  it("follow a line that is moved, and every line has its own key", () => {
    const lines = [{ id: "da", label: "A", text: "first" }, { id: "db", label: "B", text: "second" }];
    const swapped = page(grid([item({ details: [lines[1], lines[0]] })]));
    const translated = withTranslation(swapped, "sv", { "block.g1.i1.detail-da.text": "första", "block.g1.i1.detail-db.text": "andra" });
    const shown = localizePage(translated, "sv").rows[0].columns[0].blocks[0] as ContentGridBlock;
    expect(shown.items?.[0].details.map((line) => line.text)).toEqual(["andra", "första"]);
    const keys = blockTextFields(grid([item({ details: lines })])).map((field) => field.key);
    expect(keys).toContain("block.g1.i1.detail-da.text");
    expect(keys).toContain("block.g1.i1.detail-db.label");
    expect(keys.some((key) => /detail\d/.test(key))).toBe(false);
  });

  it("are refused when two lines of an item share an id", () => {
    const bad = page(grid([item({ details: [{ id: "x", label: "A", text: "1" }, { id: "x", label: "B", text: "2" }] })]));
    expect(pageInput.safeParse(bad).success).toBe(false);
  });
});

describe("review: the builder's canvas", () => {
  it("draws a link to the front page as a link (the site does), not as an item without one", () => {
    const data = customGridData({ items: [item({ link: { kind: "home" } })], limit: 60 }, { base: "", lang: "en", locale: "en-GB" });
    expect(data.items[0].href).not.toBe("");
  });

  it("gives every kind of link an address with no market (the canvas), and a link to the root for the front page", () => {
    const where = { base: "", lang: "en", locale: "en-GB" };
    const hrefs = (link: CustomGridItem["link"]) => customGridData({ items: [item({ link })], limit: 60 }, where).items[0].href;
    expect(hrefs({ kind: "home" })).toBe("/");
    expect(hrefs({ kind: "page", slug: "about" })).toBe("/about");
    expect(itemLinkHref({ kind: "home" }, "")).toEqual({ href: "/", external: false });
    // The site's own base is never touched.
    expect(itemLinkHref({ kind: "home" }, "/s/demo/no")?.href).toBe("/s/demo/no");
  });
});

describe("review: a picture of another site", () => {
  const foreign = { url: "https://t.example/p.gif", width: 1, height: 1, alt: "" };
  const library = { url: "https://example.supabase.co/storage/v1/object/public/product-media/s/a.webp", width: 1, height: 1, alt: "" };

  it("is refused by the page, so no visitor's browser asks another site for it", () => {
    const refused = pageInput.safeParse(page(grid([item({ picture: foreign })])));
    expect(refused.success).toBe(false);
    expect(pageInput.safeParse(page(grid([item({ picture: { ...foreign, url: "http://t.example/p.gif" } })]))).success).toBe(false);
    expect(pageInput.safeParse(page(grid([item({ picture: library })]))).success).toBe(true);
  });

  it("is not drawn if one got in anyway", () => {
    const data = customGridData({ items: [item({ picture: foreign }), item({ id: "i2", picture: library })], limit: 60 }, { base: "", lang: "en", locale: "en-GB" });
    expect(data.items[0].image).toBeNull();
    expect(data.items[1].image?.url).toBe(library.url);
  });

  it("does not come along with a template, whose page would not be saved with it", () => {
    const block = grid([item({ picture: foreign }), item({ id: "i2", picture: library }), item({ id: "i3", picture: { ...library, url: "/demo/a.svg" } })]);
    const clean = sanitizeTemplate("block", block, { id: null, slug: null, hosts: [] }) as ContentGridBlock;
    expect(clean.items?.map((i) => i.picture?.url ?? null)).toEqual([null, library.url, "/demo/a.svg"]);
  });
});

describe("review: copy current items", () => {
  const tile = (over: Partial<GridItem>): GridItem => ({ id: "p", href: "/s/demo/no/p/mug", title: "Mug", excerpt: "A mug.", image: null, price: null, ...over });
  const fromTiles = (shown: GridItem[]) => {
    let n = 0;
    return itemsFromGrid("products", shown, { newId: () => `id${++n}` });
  };

  it("leaves out what is for one kind of buyer only: a custom item shows to everyone", () => {
    const shown = [tile({ id: "a", title: "For everyone", audience: "all" }), tile({ id: "b", title: "Business only", audience: "businesses" }), tile({ id: "c", title: "Private only", audience: "consumers" }), tile({ id: "d", title: "No audience" })];
    expect(fromTiles(shown).map((i) => i.title)).toEqual(["For everyone", "No audience"]);
    expect(copyLeftOut(shown)).toEqual({ restricted: 2, pictures: 0 });
  });

  it("leaves a picture from another site out, and says so", () => {
    const shown = [tile({ image: { url: "https://t.example/p.gif", alt: "x" } }), tile({ id: "q", image: { url: "/demo/mug.svg", alt: "Mug" } })];
    expect(fromTiles(shown).map((i) => i.picture?.url ?? null)).toEqual([null, "/demo/mug.svg"]);
    expect(copyLeftOut(shown)).toEqual({ restricted: 0, pictures: 1 });
    expect(pageInput.safeParse(page(grid(fromTiles(shown)))).success).toBe(true);
  });

  it("gives each copied detail line an id of its own, so the copy can be saved and translated", () => {
    const [copy] = fromTiles([tile({ fields: [{ label: "A", text: "1" }, { label: "B", text: "2" }] })]);
    expect(new Set(copy.details.map((line) => line.id)).size).toBe(2);
    expect(pageInput.safeParse(page(grid([copy]))).success).toBe(true);
  });
});

describe("review: choosing another source in the builder", () => {
  const products = { type: "products" as const };
  const withItems = grid([item({ id: "a", title: "Keep me" }), item({ id: "b", title: "And me" })]);

  it("keeps the items while another source is chosen, so choosing custom items again brings them back", () => {
    let block: ContentGridBlock = withItems;
    // Pages: the lookup's limit, the items still in the editor.
    block = { ...block, ...sourceChoice(block, "pages", products) } as ContentGridBlock;
    expect(block.source.type).toBe("pages");
    expect(block.limit).toBe(48);
    expect(block.items?.map((i) => i.id)).toEqual(["a", "b"]);
    block = { ...block, ...sourceChoice(block, "products", products) } as ContentGridBlock;
    expect(block.items).toHaveLength(2);
    block = { ...block, ...sourceChoice(block, "custom", products) } as ContentGridBlock;
    expect(block.source.type).toBe("custom");
    expect(block.limit).toBe(60);
    expect(block.items?.map((i) => i.title)).toEqual(["Keep me", "And me"]);
  });

  it("drops them only when the page is saved, whatever they hold", () => {
    const away = { ...withItems, ...sourceChoice(withItems, "pages", products) } as ContentGridBlock;
    const saved = pageInput.safeParse(page(away));
    expect(saved.success).toBe(true);
    expect(saved.success && (saved.data.rows[0].columns[0].blocks[0] as ContentGridBlock).items).toBeUndefined();
  });

  it("is what an owner does: adds three items, publishes, switches source and back, copies the items from a grid", () => {
    let items: CustomGridItem[] = [];
    let n = 0;
    for (let i = 0; i < 3; i++) items = [...items, { ...newCustomItem(`n${i}`), title: `Item ${i}`, details: [newDetailLine(`d${++n}`)] }];
    let block = grid(items);
    expect(pageInput.safeParse(page(block)).success).toBe(true);
    block = { ...block, ...sourceChoice(block, "articles", products) } as ContentGridBlock;
    block = { ...block, ...sourceChoice(block, "custom", products) } as ContentGridBlock;
    expect(block.items).toHaveLength(3);
    // Copy current items on a grid of pages turns what it shows into custom items.
    const shown: GridItem[] = [{ id: "p1", href: "/s/demo/no/om-oss", title: "About", excerpt: "Us", image: null, price: null }];
    const copied = { ...block, ...copiedItems(itemsFromGrid("pages", shown, { newId: () => "c1" })) } as ContentGridBlock;
    expect(copied.items?.map((i) => i.link)).toEqual([{ kind: "page", slug: "om-oss" }]);
    expect(pageInput.safeParse(page(copied)).success).toBe(true);
  });
});

describe("review: a picture's description (D89)", () => {
  it("stays as the owner wrote it: empty is decoration, never filled from the library (custom items are exempt from the D89 fallback)", () => {
    const data = customGridData({ items: [item({ picture: { url: "/demo/a.svg", width: 1, height: 1, alt: "" } })], limit: 60 }, { base: "", lang: "en", locale: "en-GB" });
    expect(data.items[0].image?.alt).toBe("");
  });
});
