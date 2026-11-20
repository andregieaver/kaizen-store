import { describe, expect, it, vi } from "vitest";

import { newPageContent, type PageContent, type PageRow } from "./page-content";
import { listFacts, sameListFacts, type ListFacts } from "./page-list-facts";
import type { RowModal } from "./page-modal";

vi.mock("server-only", () => ({}));

const { PAGE_INDEX_FIELDS, pageCardRow } = await import("@/server/page-reads");

/** What other pages show of a page (bloat review step 2.14): a publish that changes none of it refreshes only the page. */

const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] });

const textRow = (text: string, extra: Partial<PageRow> = {}): PageRow => ({
  id: "r1",
  type: "row",
  layout: "1",
  columns: [{ id: "c1", blocks: [{ id: "b1", type: "richText", doc: doc(text) }] }],
  ...extra,
});

const page = (over: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: "About us",
  slug: "about",
  excerpt: "Who we are.",
  rows: [textRow("We make mugs by hand.")],
  ...over,
});

const facts = (content: PageContent) => listFacts(content);
const same = (a: PageContent, b: PageContent) => sameListFacts(facts(a), facts(b));

describe("listFacts()", () => {
  it("is the same when only a row's words change and the page has its own excerpt", () => {
    expect(same(page(), page({ rows: [textRow("We make cups and bowls by hand, in Bergen.")] }))).toBe(true);
  });

  it("is the same in any order of categories and tags", () => {
    expect(same(page({ categories: ["a", "b"], tags: ["x", "y"] }), page({ categories: ["b", "a"], tags: ["y", "x"] }))).toBe(true);
  });

  const changes: [string, Partial<PageContent>][] = [
    ["the title", { title: "About" }],
    ["a translated title", { translations: { "sv-SE": { title: "Om oss" } } }],
    ["the slug", { slug: "about-us" }],
    ["the thumbnail", { thumbnail: { url: "/m/a.jpg", alt: "", width: 800, height: 600 } }],
    ["the excerpt", { excerpt: "Who we are, and why." }],
    ["the search description", { seo: { title: "", description: "Mugs by hand." } }],
    ["a translated excerpt", { translations: { "sv-SE": { excerpt: "Vilka vi är." } } }],
    ["a translated search description", { translations: { "sv-SE": { "seo.description": "Muggar." } } }],
    ["a category", { categories: ["c1"] }],
    ["a tag", { tags: ["t1"] }],
    ["markets", { markets: ["NO"] }],
    ["the blog", { blogId: "b1" }],
    ["the author", { author: "Kari" }],
    ["the author record", { authorId: "a1" }],
    ["search engines", { searchEngines: false }],
    ["AI assistants", { aiAssistants: false }],
    [
      "a timed modal that is not shown every time",
      { rows: [textRow("We make mugs by hand."), { ...textRow("Join us"), id: "r2", modal: { key: "join", triggers: { timer: { seconds: 5 } }, frequency: "session", size: "md" } }] },
    ],
    [
      "a picture in the body (the sitemaps list it)",
      { rows: [textRow("We make mugs by hand."), { id: "r3", type: "row", layout: "1", columns: [{ id: "c3", blocks: [{ id: "i1", type: "image", caption: "", image: { url: "/m/b.jpg", alt: "" } }] }] } as PageRow] },
    ],
  ];
  it.each(changes)("changes with %s", (_name, over) => {
    expect(same(page(), page(over))).toBe(false);
  });

  it("changes with the thumbnail's description, in the page's language and in a translation", () => {
    const pictured = page({ thumbnail: { url: "/m/a.jpg", alt: "A mug", width: 800, height: 600 } });
    expect(same(pictured, page({ thumbnail: { url: "/m/a.jpg", alt: "Two mugs", width: 800, height: 600 } }))).toBe(false);
    expect(same(pictured, { ...pictured, translations: { "sv-SE": { "thumbnail.alt": "En mugg" } } })).toBe(false);
  });

  it("follows the words when they are the excerpt: neither excerpt nor search description", () => {
    const bare = page({ excerpt: undefined });
    expect(facts(bare).excerpt).toBe("We make mugs by hand.");
    expect(same(bare, page({ excerpt: undefined, rows: [textRow("We make bowls.")] }))).toBe(false);
    // In a translation too: the translated words are that language's excerpt.
    expect(same(bare, { ...bare, translations: { "sv-SE": { "block.b1.doc": doc("Vi gör muggar.") } } })).toBe(false);
  });

  it("says a remembered modal as the stored column does (`remembered_modal` in src/db/schema.ts, src/lib/page-modal.ts)", () => {
    const modal = (over: Partial<RowModal> = {}): RowModal => ({ key: "promo", triggers: { timer: { seconds: 5 } }, frequency: "session", size: "md", ...over });
    const samples: [RowModal, boolean][] = [
      [modal(), true],
      [modal({ frequency: "days", days: 7 }), true],
      [modal({ frequency: "always" }), false],
      [modal({ triggers: { exitIntent: true } }), true],
      [modal({ triggers: { exitIntent: true }, frequency: "always" }), false],
      [modal({ triggers: { button: true } }), false],
      [modal({ triggers: { className: "open-promo" } }), false],
      // Stored without a frequency: the column counts it.
      [{ ...modal(), frequency: undefined } as unknown as RowModal, true],
    ];
    for (const [m, remembers] of samples) {
      expect(facts(page({ rows: [textRow("x", { modal: m })] })).rememberedModal, JSON.stringify(m)).toBe(remembers);
    }
  });
});

/**
 * Every field a list reads of a page, mapped to the list fact that holds it, or to `not content` (its id and dates: a publish's date reaches
 * the sitemaps and the feed within their life, and a newest-first grid of pages makes the publish site-wide, `pageTags()`).
 */
const NOT_CONTENT = "not content";
type Mapped = keyof ListFacts | typeof NOT_CONTENT;

/** A page index's entry (`publishedPageIndex()`). */
const INDEX_MAP: Record<string, Mapped[]> = {
  id: [NOT_CONTENT],
  slug: ["slug"],
  title: ["title"],
  titles: ["titles"],
  publishedAt: [NOT_CONTENT],
  firstPublishedAt: [NOT_CONTENT],
  blogId: ["blogId"],
  aiAssistants: ["aiAssistants"],
  searchEngines: ["searchEngines"],
};

/** A grid's or a blog's card (`pageCardRow`, read by `pageCardColumns()` in a language). */
const CARD_MAP: Record<string, Mapped[]> = {
  id: [NOT_CONTENT],
  slug: ["slug"],
  title: ["title", "titles"],
  excerpt: ["excerpt", "excerpts"],
  description: ["description", "descriptions"],
  image_url: ["thumbnail"],
  image_alt: ["thumbnailAlt", "thumbnailAlts"],
  blog_id: ["blogId"],
  markets: ["markets"],
  author: ["author"],
  author_id: ["authorId"],
  first_published_at: [NOT_CONTENT],
  published_at: [NOT_CONTENT],
};

/** What the page branch of `gridData()` (`gridPages()` in src/server/content-grid.ts) reads of a page besides its card. */
const GRID_FILTERS: Record<string, Mapped[]> = {
  "published -> categories": ["categories"],
  "published -> tags": ["tags"],
  // A grid of a parent's pages (D185) matches the address; a grid sorted by title, the title.
  "p.slug (parent)": ["slug"],
  "published ->> title (sort)": ["title"],
};

describe("the lists' fields are each a list fact", () => {
  const keys = Object.keys(facts(page())) as (keyof ListFacts)[];
  const valid = (mapped: Mapped[]) => mapped.every((m) => m === NOT_CONTENT || keys.includes(m));

  it("maps every field of a page index's entry", () => {
    expect(PAGE_INDEX_FIELDS.filter((field) => !(field in INDEX_MAP))).toEqual([]);
    expect(Object.keys(INDEX_MAP).filter((field) => !PAGE_INDEX_FIELDS.includes(field))).toEqual([]);
    expect(Object.values(INDEX_MAP).every(valid)).toBe(true);
  });

  it("maps every field of a grid's card", () => {
    const fields = Object.keys(pageCardRow.shape);
    expect(fields.filter((field) => !(field in CARD_MAP))).toEqual([]);
    expect(Object.keys(CARD_MAP).filter((field) => !fields.includes(field))).toEqual([]);
    expect(Object.values(CARD_MAP).every(valid)).toBe(true);
    expect(Object.values(GRID_FILTERS).every(valid)).toBe(true);
  });
});
