import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, richTextPlain, type PageBlock, type PageContent, type PageRow } from "./page-content";
import { textToRichText } from "./simple-rich-text";
import {
  OUTLINE_TEXTS_MAX,
  SHARED_TEXT,
  applyPageEdits,
  briefClaims,
  briefOf,
  buildPageInput,
  dryRunEdits,
  editPageInput,
  headerFooterSummary,
  menuSummary,
  otherStoreAddress,
  ownerWordsOf,
  placeName,
  placeSummary,
  saveMenuInput,
  toMenuEntries,
  pageOutline,
  publishSummary,
  sharedTextKeys,
  type PageChange,
} from "./site-tools";

const heading = (id: string, text: string): PageBlock => ({ id, type: "heading", text, level: 2 });
const rich = (id: string, text: string): PageBlock => ({ id, type: "richText", doc: textToRichText(text) });
const image = (id: string): PageBlock => ({ id, type: "image", image: null, caption: "" });
const row = (id: string, blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks }],
  ...extra,
});

function page(): PageContent {
  return {
    ...newPageContent(),
    title: "About us",
    slug: "about-us",
    seo: { title: "", description: "Who we are." },
    rows: [
      row("r1", [heading("h1", "Who we are"), rich("t1", "We bake bread every morning.\n\nSince 1990.")]),
      row("r2", [heading("h2", "Visit us"), image("i2")]),
      row("r3", [heading("h3", "Opening hours")]),
    ],
  };
}

const edit = (changes: unknown[]) => editPageInput.parse({ page: "about-us", changes }).changes;
const apply = (changes: unknown[], content = page(), sections: PageRow[][] = []) =>
  applyPageEdits(content, edit(changes), { sections, allowLink: (href) => href === "/contact" });

describe("reading a page for the AI manager", () => {
  it("names its texts by the keys set_text takes and its rows in order, with what each holds", () => {
    const outline = pageOutline(page());
    expect(outline.texts.map((t) => t.key)).toEqual(["title", "excerpt", "seo.title", "seo.description"]);
    expect(outline.rows.map((r) => [r.row, r.number])).toEqual([
      ["r1", 1],
      ["r2", 2],
      ["r3", 3],
    ]);
    expect(outline.rows[0].texts.map((t) => [t.key, t.text, t.rich])).toEqual([
      ["block.h1.text", "Who we are", false],
      ["block.t1.doc", "We bake bread every morning.\nSince 1990.", true],
    ]);
    expect(outline.rows[1].parts).toEqual(["heading", "image (no picture yet)"]);
    expect(outline.more_texts).toBe(0);
  });

  it("reads out at most so many texts and counts the rest", () => {
    const many = { ...page(), rows: Array.from({ length: 40 }, (_, n) => row(`r${n}`, Array.from({ length: 5 }, (_, b) => heading(`h${n}-${b}`, `Heading ${n} ${b}`)))) };
    const outline = pageOutline(many);
    const read = outline.texts.length + outline.rows.reduce((sum, r) => sum + r.texts.length, 0);
    expect(read).toBe(OUTLINE_TEXTS_MAX);
    expect(outline.more_texts).toBe(4 + 200 - OUTLINE_TEXTS_MAX);
  });
});

describe("changing a page's words", () => {
  it("sets a plain text and a rich one by key and keeps the rest of the page as it was", () => {
    const before = page();
    const done = apply([
      { do: "set_text", key: "block.h3.text", text: "When we are open" },
      { do: "set_text", key: "block.t1.doc", text: "We bake every morning.\n\n- Bread\n- Buns\n\n[Write to us](/contact) or [elsewhere](https://example.com)" },
    ]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const [r1, r2, r3] = done.content.rows;
    expect(r3.columns[0].blocks[0]).toMatchObject({ type: "heading", text: "When we are open" });
    const text = r1.columns[0].blocks[1];
    expect(text.type === "richText" && richTextPlain(text.doc)).toContain("Buns");
    // A link only to the site's own address: the other keeps its words without one.
    expect(JSON.stringify(text)).toContain('"/contact"');
    expect(JSON.stringify(text)).not.toContain("example.com");
    expect(r2).toEqual(before.rows[1]);
    expect(r1.columns[0].blocks[0]).toEqual(before.rows[0].columns[0].blocks[0]);
    expect(done.content.title).toBe("About us");
    expect(pageInput.safeParse(done.content).success).toBe(true);
  });

  it("refuses a key that is not there, a text too long, and a claim", () => {
    expect(apply([{ do: "set_text", key: "block.nope.text", text: "x" }])).toMatchObject({ ok: false, problem: expect.stringContaining("get_page") });
    expect(apply([{ do: "set_text", key: "seo.title", text: "x".repeat(71) }])).toMatchObject({ ok: false, problem: expect.stringContaining("at most 70") });
    expect(apply([{ do: "set_text", key: "block.h3.text", text: "Only 2 left, order now!" }])).toMatchObject({ ok: false, problem: expect.stringContaining("claims") });
  });

  it("replaces words everywhere, and says when they are not there", () => {
    const done = apply([{ do: "replace", find: "bread", replace: "loaves" }]);
    expect(done).toMatchObject({ ok: true, done: ['Replaced "bread" once.'] });
    expect(apply([{ do: "replace", find: "croissant", replace: "x" }])).toMatchObject({ ok: false, problem: '"croissant" is not on the page.' });
  });

  it("leaves texts in parts shared with other pages to the builder", () => {
    const shared = { ...page(), rows: [row("g", [heading("gh", "Free delivery in Oslo")], { global: "part-1" }), ...page().rows] };
    expect(sharedTextKeys(shared).has("block.gh.text")).toBe(true);
    expect(apply([{ do: "set_text", key: "block.gh.text", text: "Delivery" }], shared)).toMatchObject({ ok: false, problem: SHARED_TEXT });
    expect(apply([{ do: "replace", find: "Oslo", replace: "Bergen" }], shared)).toMatchObject({ ok: false, problem: expect.stringContaining("only in parts shared") });
    // A part the page made its own inside a global use is the page's.
    const own = { ...shared, rows: [row("g", [{ ...heading("gh", "Free delivery in Oslo"), local: true }], { global: "part-1" }), ...page().rows] };
    expect(sharedTextKeys(own).has("block.gh.text")).toBe(false);
  });
});

describe("changing a page's rows", () => {
  const section = [row("new", [heading("hn", "Our story")])];

  it("adds a section where it is asked, at the end without a place", () => {
    const at2 = apply([{ do: "add_section", pattern: "text", name: "Story", brief: "Our story", at: 2 }], page(), [section]);
    expect(at2.ok && at2.content.rows.map((r) => r.id)).toEqual(["r1", "new", "r2", "r3"]);
    const last = apply([{ do: "add_section", pattern: "text", name: "Story", brief: "Our story" }], page(), [section]);
    expect(last.ok && last.content.rows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "new"]);
    expect(last.ok && last.done).toEqual(['Added "Story" as row 4.']);
  });

  it("puts an opening only first", () => {
    expect(apply([{ do: "add_section", pattern: "hero", name: "Opening", brief: "Welcome", at: 2 }], page(), [section])).toMatchObject({
      ok: false,
      problem: expect.stringContaining("only ever the first row"),
    });
  });

  it("removes and moves rows by id, in order, refusing a row that is not there", () => {
    const done = apply([
      { do: "move_row", row: "r3", to: 1 },
      { do: "remove_row", row: "r2" },
    ]);
    expect(done.ok && done.content.rows.map((r) => r.id)).toEqual(["r3", "r1"]);
    expect(done.ok && done.done).toEqual(["Moved row 3 to 1.", "Removed row 3."]);
    expect(apply([{ do: "remove_row", row: "gone" }])).toMatchObject({ ok: false, problem: expect.stringContaining("no row") });
  });

  it("names the change that could not be made when there are several, and makes none", () => {
    const changes = [
      { do: "set_text", key: "block.h3.text", text: "Hours" },
      { do: "move_row", row: "gone", to: 1 },
    ];
    expect(apply(changes)).toMatchObject({ ok: false, problem: expect.stringMatching(/^Change 2: /) });
  });

  it("tries everything before a section is written, a planned section standing in as an empty row", () => {
    const changes: PageChange[] = edit([
      { do: "add_section", pattern: "text", name: "Story", brief: "Our story", at: 1 },
      { do: "set_text", key: "block.nope.text", text: "x" },
    ]);
    expect(dryRunEdits(page(), changes)).toMatchObject({ ok: false, problem: expect.stringContaining("Change 2") });
    expect(dryRunEdits(page(), changes.slice(0, 1)).ok).toBe(true);
  });
});

describe("a brief for a page", () => {
  const args = buildPageInput.parse({
    title: "Catering",
    purpose: "Tell companies we cater lunches",
    key_points: ["Lunch for 10 to 200 people"],
    facts: ["We deliver in Oslo on weekdays"],
    pictures: false,
  });

  it("becomes the page studio's brief, with no pictures as the studio's none", () => {
    expect(briefOf(args)).toMatchObject({ title: "Catering", keyPoints: ["Lunch for 10 to 200 people"], facts: ["We deliver in Oslo on weekdays"], pictures: "none" });
    expect(briefOf({ ...args, pictures: true, picture_style: "bright daylight" }).pictures).toBe("bright daylight");
  });

  it("gives its facts as the owner's words, and finds claims in it", () => {
    expect(ownerWordsOf(args)).toContain("We deliver in Oslo on weekdays");
    expect(briefClaims(args)).toEqual([]);
    expect(briefClaims({ ...args, key_points: ["The lowest prices in Norway"] }).length).toBeGreaterThan(0);
  });

  it("is described for the owner's approval by the page's title", () => {
    expect(publishSummary("page", "Catering", "catering")).toBe('Publish the page "Catering", so visitors see its draft as it is now.');
    expect(publishSummary("article", null, "news")).toContain("article news");
  });
});

describe("menus for the AI manager", () => {
  it("knows a web address into another store on Kaizena Flow, by path or by host, and lets the wider web be", () => {
    expect(otherStoreAddress("/s/other-shop/no/products", "mine", null)).toBe(true);
    expect(otherStoreAddress("/s/mine/no/about", "mine", null)).toBe(false);
    expect(otherStoreAddress("/about", "mine", null)).toBe(false);
    expect(otherStoreAddress("https://other-shop.kaizenstores.com/no", "mine", "kaizenstores.com")).toBe(true);
    expect(otherStoreAddress("https://mine.kaizenstores.com/no", "mine", "kaizenstores.com")).toBe(false);
    expect(otherStoreAddress("https://kaizenaflow.com/s/other-shop", "mine", "kaizenstores.com")).toBe(true);
    expect(otherStoreAddress("https://kaizenstores.com/s/other-shop/no", "mine", "kaizenstores.com")).toBe(true);
    expect(otherStoreAddress("https://www.example.com/s/anything", "mine", "kaizenstores.com")).toBe(false);
    expect(otherStoreAddress("https://www.instagram.com/mine", "mine", "kaizenstores.com")).toBe(false);
  });

  it("turns the tool's links into the menu editor's, keeping a mega menu and a picture where the link is still there", () => {
    const { items } = saveMenuInput.parse({
      menu: "Main",
      items: [
        { text: "Shop", texts: { "sv-SE": "Butik" }, link: { kind: "products" } },
        { text: "About", link: { kind: "page", slug: "about-us" }, depth: 1, new_tab: true },
      ],
    });
    const before = [{ label: { "nb-NO": "Butikk" }, link: { kind: "products" as const }, depth: 0, mega: { columns: 3 }, image: { url: "/x.webp", width: 10, height: 10 } }];
    expect(toMenuEntries(items, "nb-NO", before)).toEqual([
      { label: { "sv-SE": "Butik", "nb-NO": "Shop" }, link: { kind: "products" }, depth: 0, mega: { columns: 3 }, image: { url: "/x.webp", width: 10, height: 10 } },
      { label: { "nb-NO": "About" }, link: { kind: "page", slug: "about-us" }, depth: 1, newTab: true },
    ]);
  });

  it("says what a menu, a place and the header and footer change to, for the owner's approval", () => {
    const { items } = saveMenuInput.parse({ items: [{ text: "Shop", link: { kind: "products" } }, { link: { kind: "page", slug: "about-us" } }] });
    expect(menuSummary("Main", items, false)).toBe('Change the menu "Main" to 2 links: Shop, /about-us.');
    expect(placeName("not_found")).toBe("404 page");
    expect(placeSummary("front", "Welcome")).toBe('Show the page "Welcome" as the front page.');
    expect(placeSummary("products", null)).toBe("Show the standard All products page again.");
    expect(headerFooterSummary({ header: "Main", logo: false })).toBe('Change the standard header and footer: the header shows the menu "Main"; no logo (the site\'s name shows).');
  });
});
