import { describe, expect, it } from "vitest";

import { claimsInItem, itemLinkHref, itemsFromGrid, linkFromHref, customGridData, shownCustomItems } from "./custom-grid";
import type { GridItem } from "./content-grid";
import {
  CUSTOM_ITEMS_MAX,
  blockHasContent,
  blockText,
  customItemShows,
  newPageContent,
  pageExcerpt,
  pageInput,
  type ContentGridBlock,
  type CustomGridItem,
  type PageContent,
} from "./page-content";
import { copyBlock, copyRow, newBlock, newRow } from "./page-rows";

/** Custom grid items (D155): the data, its rules, and what the grid draws from them. */

let n = 0;
const nextId = () => `id${++n}`;
const item = (over: Partial<CustomGridItem> = {}): CustomGridItem => ({
  id: nextId(),
  title: "Fjord tour",
  text: "A day on the water.",
  picture: null,
  link: null,
  buttonLabel: "",
  date: null,
  badge: "",
  priceText: "",
  details: [],
  ...over,
});
const grid = (over: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
  source: { type: "custom" },
  limit: CUSTOM_ITEMS_MAX,
  items: [item()],
  ...over,
});
const pageWith = (block: ContentGridBlock): PageContent => ({
  ...newPageContent(),
  title: "Tours",
  slug: "tours",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
});
const parse = (block: ContentGridBlock) => pageInput.safeParse(pageWith(block));
const problems = (block: ContentGridBlock) => {
  const result = parse(block);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("the schema of a grid of custom items", () => {
  it("accepts a custom grid with every field of an item", () => {
    const full = item({
      picture: { url: "https://example.supabase.co/storage/v1/object/public/a.webp", width: 800, height: 600, alt: "A boat" },
      link: { kind: "page", slug: "tours" },
      buttonLabel: "Book",
      date: "2026-05-17",
      badge: "New",
      priceText: "From 199 kr",
      details: [{ id: "d1", label: "Length", text: "6 hours" }],
    });
    const result = parse(grid({ items: [full, item({ link: { kind: "url", url: "https://example.com/x" } }), item({ link: { kind: "product", handle: "kopp" } })] }));
    expect(result.success).toBe(true);
    const block = result.success ? (result.data.rows[0].columns[0].blocks[0] as ContentGridBlock) : null;
    expect(block?.items?.[0]).toEqual(full);
  });

  it("accepts a grid with no items yet", () => {
    expect(parse(grid({ items: [] })).success).toBe(true);
    expect(parse(grid({ items: undefined })).success).toBe(true);
  });

  it("refuses categories, tags, filters and tile fields: they are for what is looked up", () => {
    expect(problems(grid({ categories: ["a2b4f4a0-1c0c-4a35-8d52-3d3d3f2bd1aa"] }))).toContain("A grid of custom items has no categories or tags.");
    expect(problems(grid({ tags: ["a2b4f4a0-1c0c-4a35-8d52-3d3d3f2bd1aa"] }))).toContain("A grid of custom items has no categories or tags.");
    expect(problems(grid({ filters: true }))).toContain("Filters are for grids of products.");
    expect(problems(grid({ tileFields: ["f_material"] }))).toContain("A grid of custom items has no custom fields on its tiles.");
  });

  it("holds at most CUSTOM_ITEMS_MAX items, and the limit may be that high only for custom items", () => {
    const many = Array.from({ length: CUSTOM_ITEMS_MAX + 1 }, () => item());
    expect(problems(grid({ items: many }))).toContain(`A grid holds at most ${CUSTOM_ITEMS_MAX} custom items.`);
    expect(parse(grid({ items: many.slice(0, CUSTOM_ITEMS_MAX) })).success).toBe(true);
    expect(problems(grid({ source: { type: "pages" }, items: undefined, limit: 49 }))).toContain("A grid shows at most 48 items.");
    expect(parse(grid({ source: { type: "pages" }, items: undefined, limit: 48 })).success).toBe(true);
  });

  it("drops items left in a grid that looks its items up when the page is saved, so choosing another source never loses them before that", () => {
    // The editor keeps them while the owner is choosing; nothing shows them and the schema refuses items on any other source.
    for (const type of ["pages", "articles", "products"] as const) {
      const result = parse(grid({ source: { type }, limit: 6 }));
      expect(result.success, type).toBe(true);
      const block = result.success ? (result.data.rows[0].columns[0].blocks[0] as ContentGridBlock) : null;
      expect(block?.items, type).toBeUndefined();
      expect(block?.source.type).toBe(type);
    }
    // Even a stranded item that would not pass the schema does not stop the page from being saved.
    expect(parse(grid({ source: { type: "pages" }, limit: 6, items: [item({ title: "x".repeat(500) })] })).success).toBe(true);
    // Those of a custom grid are kept.
    const kept = parse(grid({ items: [item()] }));
    expect(kept.success && (kept.data.rows[0].columns[0].blocks[0] as ContentGridBlock).items).toHaveLength(1);
  });

  it("refuses texts over their limits", () => {
    const over = (field: Partial<CustomGridItem>) => problems(grid({ items: [item(field)] }));
    expect(over({ title: "x".repeat(201) })).toHaveLength(1);
    expect(over({ text: "x".repeat(601) })).toHaveLength(1);
    expect(over({ badge: "x".repeat(41) })).toHaveLength(1);
    expect(over({ priceText: "x".repeat(61) })).toHaveLength(1);
    expect(over({ buttonLabel: "x".repeat(61) })).toHaveLength(1);
    expect(over({ details: [{ id: "d1", label: "x".repeat(61), text: "" }] })).toHaveLength(1);
    expect(over({ details: [{ id: "d1", label: "", text: "x".repeat(121) }] })).toHaveLength(1);
    expect(over({ details: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, label: "a", text: "b" })) })).toEqual(["An item shows at most 3 detail lines."]);
    expect(over({ title: "x".repeat(200), text: "x".repeat(600), badge: "x".repeat(40), priceText: "x".repeat(60), buttonLabel: "x".repeat(60) })).toEqual([]);
  });

  it("refuses an unsafe link, a link of an unknown kind and a link to nothing", () => {
    const link = (value: unknown) => problems(grid({ items: [item({ link: value as CustomGridItem["link"] })] }));
    expect(link({ kind: "url", url: "javascript:alert(1)" })).not.toEqual([]);
    expect(link({ kind: "url", url: "data:text/html,<script>1</script>" })).not.toEqual([]);
    expect(link({ kind: "url", url: "//evil.example/x" })).not.toEqual([]);
    expect(link({ kind: "url", url: "ftp://example.com" })).not.toEqual([]);
    expect(link({ kind: "page" })).not.toEqual([]);
    expect(link({ kind: "page", slug: "Not A Slug" })).not.toEqual([]);
    expect(link({ kind: "pageId", id: "x" })).not.toEqual([]);
    expect(link({ kind: "url", url: "/about" })).toEqual([]);
    expect(link({ kind: "url", url: "#kontakt" })).toEqual([]);
    expect(link({ kind: "url", url: "https://example.com" })).toEqual([]);
    expect(link({ kind: "category", slug: "kopper" })).toEqual([]);
    expect(link({ kind: "home" })).toEqual([]);
  });

  it("refuses a picture that is not the library's or the site's own, whose address is not a web address, or whose size is not a size", () => {
    const picture = (value: unknown) => problems(grid({ items: [item({ picture: value as CustomGridItem["picture"] })] }));
    const good = { url: "https://example.supabase.co/storage/v1/object/public/a.webp", width: 10, height: 10, alt: "" };
    expect(picture(good)).toEqual([]);
    expect(picture({ ...good, url: "javascript:alert(1)" })).not.toEqual([]);
    expect(picture({ ...good, url: "ftp://example.com/a.webp" })).not.toEqual([]);
    // A path on the site is the site's own file (the demo products' pictures are such paths).
    expect(picture({ ...good, url: "/relative.webp" })).toEqual([]);
    expect(picture({ ...good, url: "/demo/mug.svg" })).toEqual([]);
    for (const outside of ["//evil.example/a.gif", "/\\evil.example/a.gif", "/../a.gif", "relative.webp", ""]) expect(picture({ ...good, url: outside }), outside).not.toEqual([]);
    // Another site's picture is fetched by every visitor's browser, with no consent: a tracking pixel, and `http:` is mixed content.
    expect(picture({ ...good, url: "https://t.example/p.gif" })).toEqual(["An item's picture must be a file from your media library or this site, not another site's."]);
    expect(picture({ ...good, url: "http://t.example/p.gif" })).not.toEqual([]);
    expect(picture({ ...good, url: "http://example.supabase.co/storage/v1/object/public/a.webp" })).not.toEqual([]);
    expect(picture({ ...good, url: "https://user:pass@example.supabase.co/storage/v1/object/public/a.webp" })).not.toEqual([]);
    expect(picture({ ...good, url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })).not.toEqual([]);
    expect(picture({ ...good, width: 0 })).not.toEqual([]);
    expect(picture({ ...good, height: 10_001 })).not.toEqual([]);
    expect(picture({ ...good, alt: "x".repeat(201) })).not.toEqual([]);
  });

  it("refuses a date that is not a day, and two items with one id", () => {
    expect(problems(grid({ items: [item({ date: "17.05.2026" })] }))).not.toEqual([]);
    expect(problems(grid({ items: [item({ date: "2026-02-30" })] }))).not.toEqual([]);
    expect(problems(grid({ items: [item({ date: "2026-02-28" })] }))).toEqual([]);
    const a = item({ id: "same" });
    expect(problems(grid({ items: [a, { ...a }] }))).toEqual(["Two items have the same id. Reload the page and try again."]);
  });

  it("fills a stored item's gaps, so an older or lighter item is read", () => {
    const light = { id: "x1", title: "Only a title" } as unknown as CustomGridItem;
    const result = parse(grid({ items: [light] }));
    expect(result.success).toBe(true);
    const block = result.success ? (result.data.rows[0].columns[0].blocks[0] as ContentGridBlock) : null;
    expect(block?.items?.[0]).toEqual(item({ id: "x1", title: "Only a title", text: "" }));
  });
});

describe("what shows", () => {
  it("is an item with a title, a picture or text, and an empty one is skipped", () => {
    const picture = { url: "/demo/a.webp", width: 1, height: 1, alt: "" };
    expect(customItemShows(item())).toBe(true);
    expect(customItemShows(item({ title: "", text: "Words" }))).toBe(true);
    expect(customItemShows(item({ title: "  ", text: "", picture }))).toBe(true);
    expect(customItemShows(item({ title: "", text: "", badge: "New", priceText: "10 kr", link: { kind: "home" } }))).toBe(false);
  });

  it("is a block with something to show, and none of it is the page's own words", () => {
    expect(blockHasContent(grid({ items: [] }))).toBe(false);
    expect(blockHasContent(grid({ items: [item({ title: "", text: "" })] }))).toBe(false);
    expect(blockHasContent(grid())).toBe(true);
    // The other sources look their items up, so the block always has something to ask for.
    expect(blockHasContent(grid({ source: { type: "pages" }, items: undefined }))).toBe(true);
    // The excerpt and llms.txt are the page's words: a custom item's are the grid's.
    expect(blockText(grid())).toBe("");
    expect(pageExcerpt(pageWith(grid()))).toBe("");
  });
});

describe("a custom grid's items as grid data", () => {
  const where = { base: "/s/demo/no", lang: "nb", locale: "nb-NO" };

  it("are the block's items in the owner's order, with the empty ones skipped", () => {
    const items = [item({ title: "B" }), item({ title: "", text: "" }), item({ title: "A" }), item({ title: "C" })];
    const data = customGridData({ items, limit: 60 }, where);
    expect(data.items.map((i) => i.title)).toEqual(["B", "A", "C"]);
    expect(data.items.map((i) => i.id)).toEqual([items[0].id, items[2].id, items[3].id]);
    expect(data.lang).toBe("nb");
    expect(data.locale).toBe("nb-NO");
  });

  it("honours the limit when it is smaller than the items", () => {
    const items = [item({ title: "1" }), item({ title: "2" }), item({ title: "3" })];
    expect(customGridData({ items, limit: 2 }, where).items.map((i) => i.title)).toEqual(["1", "2"]);
    expect(shownCustomItems({ items, limit: 10 })).toHaveLength(3);
    expect(shownCustomItems({ items: undefined, limit: 6 })).toEqual([]);
  });

  it("carry the words of an item as plain text and never as a price", () => {
    const data = customGridData(
      {
        limit: 60,
        items: [
          item({
            text: "Words",
            badge: "-20 %",
            priceText: "From 199 kr",
            buttonLabel: "Book",
            date: "2026-05-17",
            details: [
              { id: "d1", label: "Length", text: "6 hours" },
              { id: "d2", label: "Empty", text: " " },
            ],
            picture: { url: "/demo/a.webp", width: 40, height: 30, alt: "Boat" },
          }),
        ],
      },
      where,
    );
    const [tile] = data.items;
    expect(tile).toMatchObject({ excerpt: "Words", badge: "-20 %", priceText: "From 199 kr", buttonLabel: "Book", date: "2026-05-17", price: null });
    expect(tile.fields).toEqual([{ label: "Length", text: "6 hours" }]);
    expect(tile.image).toEqual({ url: "/demo/a.webp", alt: "Boat", width: 40, height: 30 });
  });

  it("link by slug within the market, and have no address without a link", () => {
    const data = customGridData(
      {
        limit: 60,
        items: [
          item({ link: { kind: "page", slug: "om-oss" } }),
          item({ link: { kind: "product", handle: "kopp" } }),
          item({ link: { kind: "category", slug: "kopper" } }),
          item({ link: { kind: "article", slug: "nytt" } }),
          item({ link: { kind: "home" } }),
          item({ link: { kind: "url", url: "https://example.com/x" } }),
          item({ link: { kind: "url", url: "/about" } }),
          item({ link: null }),
        ],
      },
      where,
    );
    expect(data.items.map((i) => i.href)).toEqual([
      "/s/demo/no/om-oss",
      "/s/demo/no/p/kopp",
      "/s/demo/no/category/kopper",
      "/s/demo/no/blog/nytt",
      "/s/demo/no",
      "https://example.com/x",
      "/s/demo/no/about",
      "",
    ]);
    expect(data.items.map((i) => Boolean(i.external))).toEqual([false, false, false, false, false, true, false, false]);
  });

  it("leaves a link that is not safe without an address, even from a stored item the schema would refuse", () => {
    expect(itemLinkHref({ kind: "url", url: "javascript:alert(1)" }, "/s/demo/no")).toBeNull();
    expect(itemLinkHref({ kind: "url", url: "//evil.example" }, "/s/demo/no")).toBeNull();
    expect(itemLinkHref(null, "/s/demo/no")).toBeNull();
  });

  it("link from Kaizen's own pages by address, with no store's products, account or cart", () => {
    expect(itemLinkHref({ kind: "page", slug: "om-oss" }, null)).toEqual({ href: "/om-oss", external: false });
    expect(itemLinkHref({ kind: "home" }, null)).toEqual({ href: "/", external: false });
    expect(itemLinkHref({ kind: "blog" }, null)).toEqual({ href: "/blog", external: false });
    expect(itemLinkHref({ kind: "category", slug: "a" }, null)).toEqual({ href: "/category/a", external: false });
    for (const link of [{ kind: "product", handle: "x" }, { kind: "products" }, { kind: "account" }, { kind: "cart" }] as const) {
      expect(itemLinkHref(link, null)).toBeNull();
    }
  });
});

describe("copying what a grid shows now into custom items", () => {
  const tile = (over: Partial<GridItem> = {}): GridItem => ({ id: "p1", href: "/s/demo/no/p/kopp", title: "Kopp", excerpt: "En fin kopp.", image: { url: "https://example.supabase.co/storage/v1/object/public/k.webp", alt: "Kopp" }, price: null, ...over });
  let k = 0;
  const options = { newId: () => `new${++k}` };

  it("reads a link back as a slug, whatever the market's address", () => {
    expect(linkFromHref("products", "/s/demo/no/p/kopp")).toEqual({ kind: "product", handle: "kopp" });
    expect(linkFromHref("products", "/no-en-eur/p/kopp?x=1")).toEqual({ kind: "product", handle: "kopp" });
    expect(linkFromHref("products", "/s/demo/no/p/k%C3%B8p")).toEqual({ kind: "product", handle: "køp" });
    expect(linkFromHref("articles", "/s/demo/no/blog/nytt")).toEqual({ kind: "article", slug: "nytt" });
    expect(linkFromHref("pages", "/s/demo/no/om-oss")).toEqual({ kind: "page", slug: "om-oss" });
    expect(linkFromHref("pages", "/om-oss")).toEqual({ kind: "page", slug: "om-oss" });
    expect(linkFromHref("products", "/s/demo/no/om-oss")).toBeNull();
    expect(linkFromHref("custom", "/x")).toBeNull();
    expect(linkFromHref("pages", "")).toBeNull();
  });

  it("keeps titles, excerpts, pictures and links, and never turns a price into words", () => {
    const priced = tile({ price: { view: { amountMinor: 19900, currency: "NOK", vat: { rate: 0.25, shown: "incl" } } as never, from: true } });
    const [copy] = itemsFromGrid("products", [priced], { ...options, pictureSize: () => ({ width: 640, height: 480 }) });
    expect(copy).toMatchObject({ title: "Kopp", text: "En fin kopp.", link: { kind: "product", handle: "kopp" }, priceText: "", badge: "", buttonLabel: "" });
    expect(copy.picture).toEqual({ url: "https://example.supabase.co/storage/v1/object/public/k.webp", alt: "Kopp", width: 640, height: 480 });
    expect(JSON.stringify(copy)).not.toContain("199");
  });

  it("gives each its own id, uses a default size for a picture that could not be measured, and keeps articles' days", () => {
    const [a, b] = itemsFromGrid("articles", [tile({ href: "/s/demo/no/blog/a", date: "2026-03-04T10:00:00.000Z" }), tile({ id: "p2", href: "/s/demo/no/blog/b" })], options);
    expect(a.id).not.toBe(b.id);
    expect(a.date).toBe("2026-03-04");
    expect(b.date).toBeNull();
    expect(a.picture).toMatchObject({ width: 800, height: 600 });
    expect(a.link).toEqual({ kind: "article", slug: "a" });
  });

  it("copies at most CUSTOM_ITEMS_MAX, takes the fields as detail lines, and drops a product link on Kaizen's pages", () => {
    const many = Array.from({ length: CUSTOM_ITEMS_MAX + 5 }, (_, i) => tile({ id: `p${i}` }));
    expect(itemsFromGrid("pages", many, options)).toHaveLength(CUSTOM_ITEMS_MAX);
    const [withFields] = itemsFromGrid("products", [tile({ fields: [{ label: "A", text: "1" }, { label: "B", text: "2" }, { label: "C", text: "3" }, { label: "D", text: "4" }] })], options);
    expect(withFields.details.map(({ label, text }) => ({ label, text }))).toEqual([{ label: "A", text: "1" }, { label: "B", text: "2" }, { label: "C", text: "3" }]);
    expect(new Set(withFields.details.map((line) => line.id)).size).toBe(3);
    const [onKaizen] = itemsFromGrid("products", [tile()], { ...options, platform: true });
    expect(onKaizen.link).toBeNull();
  });

  it("makes items the schema accepts", () => {
    const items = itemsFromGrid("products", [tile({ title: "x".repeat(300), excerpt: "y ".repeat(500) })], options);
    expect(parse(grid({ items })).success).toBe(true);
  });
});

describe("copies of a grid of custom items", () => {
  it("get an id for each item, as copying a part always gives new ids", () => {
    const original = grid({ items: [item({ title: "A" }), item({ title: "B" })] });
    let m = 0;
    const copy = copyBlock(original, () => `copy${++m}`) as ContentGridBlock;
    expect(copy.id).not.toBe(original.id);
    expect(copy.items?.map((i) => i.title)).toEqual(["A", "B"]);
    for (const [index, i] of (copy.items ?? []).entries()) expect(i.id).not.toBe(original.items?.[index].id);
    // The original is untouched.
    expect(original.items?.[0].id).not.toMatch(/^copy/);
    // A row's copy reaches the grid inside it.
    const row = newRow("1", () => "row1");
    row.columns[0].blocks.push(original);
    const copied = copyRow(row, () => `r${++m}`);
    expect((copied.columns[0].blocks[0] as ContentGridBlock).items?.map((i) => i.id)).not.toEqual(original.items?.map((i) => i.id));
  });

  it("start with no items: a new grid is not custom", () => {
    const fresh = newBlock("contentGrid", () => "x") as ContentGridBlock;
    expect(fresh.items).toBeUndefined();
    expect(fresh.source.type).toBe("pages");
  });
});

describe("words an AI wrote for an item", () => {
  it("pass the claims filter: every text is checked, a picture's description may name colours", () => {
    expect(claimsInItem(item({ title: "Fjord tour", text: "A day on the water.", picture: { url: "/demo/a.webp", width: 1, height: 1, alt: "A green boat" } }))).toEqual([]);
    const found = claimsInItem(item({ title: "Eco-friendly tour", text: "Only 3 left! Best price guaranteed.", priceText: "199 kr", badge: "Sustainable", details: [{ id: "d1", label: "L", text: "100% green" }] }));
    const fields = found.map((entry) => entry.field);
    expect(fields).toContain("title");
    expect(fields).toContain("text");
    expect(fields).toContain("priceText");
    expect(fields).toContain("badge");
    expect(fields).toContain("details.0.text");
    expect(claimsInItem(item({ buttonLabel: "Last chance" })).length).toBeGreaterThan(0);
  });
});
