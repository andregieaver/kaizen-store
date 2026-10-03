import { describe, expect, it } from "vitest";

import { applyPart, describePart, partChanges, testablePart } from "./experiment-parts";
import {
  newPageContent,
  pageBlockSchema,
  pageInput,
  type ContentGridBlock,
  type CustomGridItem,
  type PageBlock,
  type PageContent,
  type PageRow,
} from "./page-content";
import { blockTextFields, localizePage, pageTexts, setBlockText, translationOf } from "./page-translation";
import { translationItems } from "./page-translate-ai";
import { newBlock } from "./page-rows";
import { isStorageUrl, leftoverStorageUrls, mapTemplateMedia, sanitizeTemplate, templateMediaUrls, type ForeignStore } from "./template-content";

/** Custom grid items (D155) everywhere an item-based block is wired: translation, templates, A/B tests. */

const PUBLIC = "https://project.supabase.co/storage/v1/object/public";
const from: ForeignStore = { id: "11111111-1111-4111-8111-111111111111", slug: "other-shop", hosts: ["other-shop.kaizen.example"] };

const item = (id: string, over: Partial<CustomGridItem> = {}): CustomGridItem => ({
  id,
  title: `Tittel ${id}`,
  text: `Tekst ${id}`,
  picture: { url: `${PUBLIC}/product-media/${from.id}/${id}.webp`, width: 100, height: 80, alt: `Bilde ${id}` },
  link: { kind: "page", slug: "om-oss" },
  buttonLabel: "Les mer",
  date: null,
  badge: "Ny",
  priceText: "Fra 199 kr",
  details: [{ id: "d1", label: "Lengde", text: "6 timer" }],
  ...over,
});
const grid = (items: CustomGridItem[] = [item("a"), item("b")]): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
  source: { type: "custom" },
  limit: 60,
  buttonLabel: "Se mer",
  emptyText: "Ingenting ennå",
  items,
});
const pageWith = (block: PageBlock): PageContent => ({
  ...newPageContent(),
  title: "Turer",
  slug: "turer",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
});

describe("a custom grid's texts to translate", () => {
  it("lists the grid's own and every item's, each by the item's id, with what it is", () => {
    const fields = blockTextFields(grid());
    const keys = fields.map((field) => field.key);
    expect(keys).toEqual([
      "block.g1.buttonLabel",
      "block.g1.emptyText",
      ...["a", "b"].flatMap((id) => [
        `block.g1.${id}.title`,
        `block.g1.${id}.text`,
        `block.g1.${id}.badge`,
        `block.g1.${id}.priceText`,
        `block.g1.${id}.buttonLabel`,
        `block.g1.${id}.alt`,
        `block.g1.${id}.detail-d1.label`,
        `block.g1.${id}.detail-d1.text`,
      ]),
    ]);
    const limits = Object.fromEntries(fields.map((field) => [field.key.replace("block.g1.", ""), field.max]));
    expect(limits).toMatchObject({ "a.title": 200, "a.text": 600, "a.badge": 40, "a.priceText": 60, "a.buttonLabel": 60, "a.alt": 200, "a.detail-d1.label": 60, "a.detail-d1.text": 120 });
    expect(fields.find((field) => field.key === "block.g1.b.title")?.label).toBe("Item 2: title");
  });

  it("adds no text to the other sources' grids", () => {
    const pages = { ...grid(), source: { type: "pages" as const }, items: undefined };
    expect(blockTextFields(pages).map((field) => field.key)).toEqual(["block.g1.buttonLabel", "block.g1.emptyText"]);
  });

  it("is set one by one, and an item without a picture has no picture text", () => {
    const set = setBlockText(grid(), "block.g1.a.title", "Title A") as ContentGridBlock;
    expect(set.items?.[0].title).toBe("Title A");
    expect(set.items?.[1].title).toBe("Tittel b");
    const bare = grid([item("a", { picture: null, details: [] })]);
    expect(blockTextFields(bare).map((field) => field.key)).not.toContain("block.g1.a.alt");
  });

  it("is read in another language over the items, whose links, pictures and numbers stay", () => {
    const page = pageWith(grid());
    const swedish = {
      ...page,
      translations: {
        "sv-SE": {
          "block.g1.a.title": "Titel A",
          "block.g1.a.priceText": "Från 199 kr",
          "block.g1.a.badge": "Ny!",
          "block.g1.a.alt": "Bild A",
          "block.g1.a.detail-d1.label": "Längd",
          "block.g1.a.detail-d1.text": "6 timmar",
          "block.g1.a.buttonLabel": "Läs mer",
          "block.g1.a.text": "Text A",
          "block.g1.buttonLabel": "Se mer på svenska",
        },
      },
    };
    expect(pageInput.safeParse(swedish).success).toBe(true);
    const shown = localizePage(swedish, "sv-SE").rows[0].columns[0].blocks[0] as ContentGridBlock;
    expect(shown.buttonLabel).toBe("Se mer på svenska");
    expect(shown.items?.[0]).toMatchObject({
      title: "Titel A",
      text: "Text A",
      badge: "Ny!",
      priceText: "Från 199 kr",
      buttonLabel: "Läs mer",
      picture: { alt: "Bild A", width: 100, height: 80 },
      details: [{ id: "d1", label: "Längd", text: "6 timmar" }],
      link: { kind: "page", slug: "om-oss" },
    });
    // The second item has no Swedish yet, so it reads as written.
    expect(shown.items?.[1].title).toBe("Tittel b");
    // The main language is the page as it is.
    expect(localizePage(swedish, "nb-NO")).toBe(swedish);
  });

  it("is made into a translation from an edited copy, only where the words differ", () => {
    const page = pageWith(grid());
    const edited = pageWith(setBlockText(grid(), "block.g1.b.text", "Text B") as ContentGridBlock);
    expect(translationOf(page, edited)).toEqual({ "block.g1.b.text": "Text B" });
  });

  it("is offered to the store's translation: every written text, and only those", () => {
    const page = pageWith(grid([item("a", { badge: "", details: [] }), item("b", { title: "", picture: null })]));
    const keys = translationItems(page, "sv-SE", "all").map((entry) => entry.key);
    expect(keys).toContain("block.g1.a.title");
    expect(keys).toContain("block.g1.a.priceText");
    expect(keys).toContain("block.g1.a.alt");
    expect(keys).toContain("block.g1.emptyText");
    // Empty texts are not asked for.
    expect(keys).not.toContain("block.g1.a.badge");
    expect(keys).not.toContain("block.g1.b.title");
    expect(keys).not.toContain("block.g1.b.alt");
    const asked = translationItems(page, "sv-SE", "missing");
    expect(asked.length).toBe(keys.length);
    const done = { ...page, translations: { "sv-SE": { "block.g1.a.title": "Titel A" } } };
    expect(translationItems(done, "sv-SE", "missing").map((entry) => entry.key)).not.toContain("block.g1.a.title");
    // Every item's text is in the page's texts, by place, with its length.
    expect(pageTexts(page).get("block.g1.a.text")).toEqual({ value: "Tekst a", max: 600 });
  });
});

describe("a custom grid in a template", () => {
  const row = (): PageRow => ({
    id: "row",
    type: "row",
    layout: "1",
    columns: [
      {
        id: "col",
        blocks: [grid([item("a"), item("b", { picture: null, link: { kind: "url", url: "https://other-shop.kaizen.example/p/x" } }), item("c", { link: { kind: "url", url: "https://example.com/ok" } })])],
      },
    ],
  });

  it("names every item's picture, once each, to be copied into the using store's library", () => {
    const urls = templateMediaUrls("row", row());
    expect(urls).toEqual([`${PUBLIC}/product-media/${from.id}/a.webp`, `${PUBLIC}/product-media/${from.id}/c.webp`]);
    expect(urls.every(isStorageUrl)).toBe(true);
  });

  it("puts the copies' addresses on the items, with the picture's size and words kept", () => {
    const mapped = mapTemplateMedia("row", row(), (url) => url.replace(from.id ?? "", "new-store")) as PageRow;
    const items = (mapped.columns[0].blocks[0] as ContentGridBlock).items ?? [];
    expect(items[0].picture).toEqual({ url: `${PUBLIC}/product-media/new-store/a.webp`, width: 100, height: 80, alt: "Bilde a" });
    expect(items[1].picture).toBeNull();
    expect(leftoverStorageUrls(mapped).every((url) => url.includes("new-store"))).toBe(true);
  });

  it("leaves an item without a picture that could not be copied, and the grid is still valid", () => {
    const mapped = mapTemplateMedia("row", sanitizeTemplate("row", row(), from), () => null) as PageRow;
    const block = mapped.columns[0].blocks[0] as ContentGridBlock;
    expect(block.items?.every((entry) => entry.picture === null)).toBe(true);
    expect(leftoverStorageUrls(mapped)).toEqual([]);
    expect(pageBlockSchema.safeParse(block).success).toBe(true);
  });

  it("keeps a link by slug, takes away a link into the other store's own site and keeps another website's", () => {
    const sanitized = sanitizeTemplate("row", row(), from) as PageRow;
    const items = (sanitized.columns[0].blocks[0] as ContentGridBlock).items ?? [];
    expect(items[0].link).toEqual({ kind: "page", slug: "om-oss" });
    expect(items[1].link).toBeNull();
    expect(items[2].link).toEqual({ kind: "url", url: "https://example.com/ok" });
    // The grid is still a grid of custom items: no categories, tags or another store's id.
    const block = sanitized.columns[0].blocks[0] as ContentGridBlock;
    expect(block.source).toEqual({ type: "custom" });
    expect(block.categories).toEqual([]);
  });

  it("never turns into a grid of products or pages", () => {
    const sanitized = sanitizeTemplate("block", grid(), from) as ContentGridBlock;
    expect(sanitized.source.type).toBe("custom");
    expect(sanitized.items).toHaveLength(2);
  });
});

describe("a custom grid in an A/B test of a part", () => {
  const target = { kind: "block" as const, id: "g1" };

  it("is named by its first titles", () => {
    expect(describePart(pageWith(grid()), target)?.label).toContain("Tittel a, Tittel b");
    expect(testablePart(pageWith(grid()), target)).toBe(true);
  });

  it("has its items as part content: a version that changes an item's words differs in that part only", () => {
    const original = pageWith(grid());
    const version = pageWith(setBlockText(grid(), "block.g1.a.priceText", "Fra 99 kr") as ContentGridBlock);
    expect(partChanges(original, version, target)).toBe("ok");
    expect(partChanges(original, pageWith(grid([item("a")])), target)).toBe("ok");
    // Anything outside the grid is not the part's.
    const outside = { ...version, rows: [...version.rows, { ...version.rows[0], id: "r2", columns: [{ id: "c2", blocks: [] }] }] };
    expect(partChanges(original, outside, target)).toBe("outside");
  });

  it("is applied with its items and their translations, and nothing else of the page", () => {
    const current = { ...pageWith(grid()), title: "Current", translations: { "sv-SE": { "block.g1.a.title": "Gammal" } } };
    const version = {
      ...pageWith(setBlockText(grid(), "block.g1.a.title", "Ny tittel") as ContentGridBlock),
      title: "A version",
      translations: { "sv-SE": { "block.g1.a.title": "Ny titel" } },
    };
    const applied = applyPart(current, version, target);
    expect(applied?.title).toBe("Current");
    expect((applied?.rows[0].columns[0].blocks[0] as ContentGridBlock).items?.[0].title).toBe("Ny tittel");
    expect(applied?.translations?.["sv-SE"]?.["block.g1.a.title"]).toBe("Ny titel");
  });
});
