import { describe, expect, it } from "vitest";

import { pageColumnSchema, pageRowSchema, type PageBlock, type PageRow } from "./page-content";
import { pageLayoutSchema, type PageLayout } from "./page-layout";
import {
  cleanHref,
  isStorageUrl,
  leftoverStorageUrls,
  mapTemplateMedia,
  partBlocks,
  sanitizeTemplate,
  templateMediaUrls,
  templateSummary,
  type ForeignStore,
} from "./template-content";

const PUBLIC = "https://project.supabase.co/storage/v1/object/public";
const from: ForeignStore = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "other-shop",
  hosts: ["other-shop.kaizen.example", "otherbrand.no"],
};

const doc = (text: string, href?: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text, ...(href ? { marks: [{ type: "link", attrs: { href } }] } : {}) }],
    },
  ],
});
const richText = (id: string, text: string, href?: string, extra: object = {}) => ({
  id,
  type: "richText",
  doc: doc(text, href),
  ...extra,
});

/** A row with one of everything that belongs to a store. */
function row(): PageRow {
  const blocks: Record<string, unknown>[] = [
    richText("b1", "Read", "/s/other-shop/no/about", {
      global: "22222222-2222-4222-8222-222222222222",
      bind: { fieldId: "f_abcdef" },
    }),
    { id: "b2", type: "button", label: "Go", href: "https://other-shop.kaizen.example/no/sale" },
    { id: "b3", type: "button", label: "Mail", href: "mailto:owner@other.example" },
    { id: "b4", type: "button", label: "Fine", href: "/about" },
    {
      id: "b5",
      type: "emailForm",
      recipients: ["owner@other.example"],
      subject: "",
      fields: [],
      submitLabel: "",
      successMessage: "",
    },
    {
      id: "b6",
      type: "image",
      image: { url: `${PUBLIC}/product-media/${from.id}/a.webp`, width: 100, height: 50, alt: "A" },
      caption: "",
    },
    {
      id: "b7",
      type: "contentGrid",
      source: { type: "products", storeId: from.id, market: "no" },
      categories: [from.id],
      tags: [from.id],
      tileFields: ["f_abcdef"],
      sort: "newest",
      limit: 4,
      columns: { mobile: 1, tablet: 2, desktop: 4 },
      show: { image: true, heading: true, excerpt: false, price: true, button: false },
      buttonLabel: "",
      emptyText: "",
      headingLevel: 3,
      excerptLines: 2,
      gap: 16,
    },
    { id: "b8", type: "menu", menuId: from.id },
    { id: "b9", type: "socialLinks", links: [{ id: "l1", network: "instagram", href: "https://instagram.com/other" }] },
    { id: "b10", type: "html", html: "<script>track()</script>", title: "Widget" },
    { id: "b11", type: "customField", groupId: "g", fieldId: "f_abcdef", source: "store" },
    {
      id: "b12",
      type: "video",
      source: "upload",
      video: { url: `${PUBLIC}/page-videos/${from.id}/v.mp4` },
      link: "",
      poster: { url: `${PUBLIC}/product-media/${from.id}/p.webp`, width: 10, height: 10 },
      title: "",
    },
    {
      id: "b13",
      type: "testimonials",
      items: [
        {
          id: "t1",
          quote: "Great",
          name: "Ann",
          role: "",
          picture: { url: `${PUBLIC}/product-media/${from.id}/ann.webp`, width: 10, height: 10 },
        },
      ],
    },
  ];
  return {
    id: "row1",
    type: "row",
    layout: "1",
    columns: [
      {
        id: "col1",
        blocks,
        link: { href: "https://otherbrand.no/deals", label: "" },
        background: {
          type: "image",
          image: { url: `${PUBLIC}/product-media/${from.id}/bg.webp`, width: 100, height: 100 },
          overlay: null,
        },
      },
    ],
    background: {
      type: "video",
      video: { url: `${PUBLIC}/page-videos/${from.id}/bg.mp4` },
      poster: { url: `${PUBLIC}/product-media/${from.id}/bgp.webp`, width: 10, height: 10 },
      overlay: null,
    },
    global: "33333333-3333-4333-8333-333333333333",
  } as unknown as PageRow;
}

const blocksOf = (content: unknown) => partBlocks("row", content as PageRow);
const byId = (content: unknown, id: string) => blocksOf(content).find((b) => b.id === id) as Record<string, unknown>;

describe("cleanHref", () => {
  it("keeps anchors, paths, other websites and nothing else of the other store's", () => {
    expect(cleanHref("", from)).toBe("");
    expect(cleanHref("#contact", from)).toBe("#contact");
    expect(cleanHref("/about", from)).toBe("/about");
    expect(cleanHref("https://example.com/x", from)).toBe("https://example.com/x");
    expect(cleanHref("/s/other-shop/no/about", from)).toBe("");
    expect(cleanHref("/s/other-shop", from)).toBe("");
    expect(cleanHref("/s/other-shop-two/no", from)).toBe("/s/other-shop-two/no");
    expect(cleanHref("https://other-shop.kaizen.example/no/x", from)).toBe("");
    expect(cleanHref("https://otherbrand.no", from)).toBe("");
    expect(cleanHref("https://kaizen.example/s/other-shop/no/x", from)).toBe("");
    expect(cleanHref("mailto:a@b.example", from)).toBe("");
    expect(cleanHref("tel:+4712345678", from)).toBe("");
    expect(cleanHref(`/no/product/${from.id}`, from)).toBe("");
    expect(cleanHref(`${PUBLIC}/field-files/${from.id}/a.pdf`, from)).toBe("");
    expect(cleanHref("not a link", from)).toBe("");
  });
});

describe("templateSummary", () => {
  it("says how many columns a row has and what is in it", () => {
    expect(templateSummary("row", row())).toContain("1 column: text, button, email form");
    expect(templateSummary("block", { id: "b", type: "heading", text: "Hi", level: 2 })).toBe("heading");
    expect(templateSummary("column", { id: "c", blocks: [] })).toBe("Empty");
  });
});

describe("sanitizeTemplate", () => {
  const clean = sanitizeTemplate("row", row(), from) as PageRow;

  it("leaves the copy valid", () => {
    expect(pageRowSchema.safeParse(clean).success).toBe(true);
    expect(pageColumnSchema.safeParse(clean.columns[0]).success).toBe(true);
  });

  it("takes out global marks, bindings and the recipients of forms", () => {
    expect(clean.global).toBeUndefined();
    expect(byId(clean, "b1").global).toBeUndefined();
    expect(byId(clean, "b1").bind).toBeUndefined();
    expect(byId(clean, "b5").recipients).toEqual([]);
  });

  it("drops links into the other store and its owner's contact details, and keeps the store-independent ones", () => {
    expect(JSON.stringify(byId(clean, "b1").doc)).not.toContain("link");
    expect(JSON.stringify(byId(clean, "b1").doc)).toContain("Read");
    expect(byId(clean, "b2").href).toBe("");
    expect(byId(clean, "b3").href).toBe("");
    expect(byId(clean, "b4").href).toBe("/about");
    expect(clean.columns[0].link).toBeUndefined();
    expect((byId(clean, "b9").links as { href: string }[])[0].href).toBe("");
  });

  it("takes out the other store's products, categories, tags, menus and custom fields", () => {
    const grid = byId(clean, "b7");
    expect(grid.source).toEqual({ type: "products" });
    expect(grid.categories).toEqual([]);
    expect(grid.tags).toEqual([]);
    expect(grid.tileFields).toBeUndefined();
    expect(byId(clean, "b8").menuId).toBeUndefined();
    expect(byId(clean, "b11")).toEqual({ id: "b11", type: "customField" });
  });

  it("empties another owner's HTML, but not Kaizen's", () => {
    expect(byId(clean, "b10").html).toBe("");
    const kaizen = sanitizeTemplate("row", row(), { id: null, slug: null, hosts: [] }, true);
    expect(byId(kaizen, "b10").html).toBe("<script>track()</script>");
  });

  it("does not change what it was given", () => {
    const original = row();
    const before = JSON.stringify(original);
    sanitizeTemplate("row", original, from);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("template media", () => {
  it("names every picture and video once, in the order read", () => {
    const urls = templateMediaUrls("row", row());
    expect(urls).toHaveLength(7);
    expect(urls.every(isStorageUrl)).toBe(true);
    expect(urls[0]).toContain("/a.webp");
  });

  it("puts the copies' addresses where the originals were", () => {
    const mapped = mapTemplateMedia("row", row(), (url) => url.replace(from.id ?? "", "new-store")) as PageRow;
    expect(leftoverStorageUrls(mapped).every((url) => url.includes("new-store"))).toBe(true);
    expect(leftoverStorageUrls(mapped)).toHaveLength(7);
  });

  it("leaves out what could not be copied: a picture, a video with its still, a background", () => {
    const mapped = mapTemplateMedia("row", sanitizeTemplate("row", row(), from), () => null) as PageRow;
    expect(byId(mapped, "b6").image).toBeNull();
    expect(byId(mapped, "b12").video).toBeNull();
    expect(byId(mapped, "b12").poster).toBeNull();
    expect((byId(mapped, "b13").items as { picture: unknown }[])[0].picture).toBeNull();
    expect(mapped.background).toBeUndefined();
    expect(mapped.columns[0].background).toBeUndefined();
    expect(leftoverStorageUrls(mapped)).toEqual([]);
    expect(pageRowSchema.safeParse(mapped).error?.issues).toBeUndefined();
  });

  it("keeps a picture that is not the site's own, and finds leftovers", () => {
    const outside: PageBlock = {
      id: "b",
      type: "image",
      image: { url: "https://cdn.example.com/a.jpg", width: 1, height: 1, alt: "" },
      caption: "",
    };
    expect(mapTemplateMedia("block", outside, (url) => (isStorageUrl(url) ? null : url))).toEqual(outside);
    expect(leftoverStorageUrls(row())).toHaveLength(7);
    expect(leftoverStorageUrls(row(), new Set(templateMediaUrls("row", row())))).toEqual([]);
  });
});

describe("page layouts (D127)", () => {
  /** Two rows: the store-bound one above, and one holding a site part and a product part (for headers and product layouts). */
  const layout = (pageType: PageLayout["pageType"] = "page", css = ".hero { color: red; }"): PageLayout => {
    const second = {
      id: "row2",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "col2",
          blocks: [
            { id: "s1", type: "site", part: "logo" },
            { id: "p1", type: "product", part: "title" },
            {
              id: "img2",
              type: "image",
              image: { url: `${PUBLIC}/product-media/${from.id}/second.webp`, width: 10, height: 10, alt: "" },
              caption: "",
            },
            richText("r2", "Second", "/s/other-shop/no/about", { global: "44444444-4444-4444-8444-444444444444" }),
            { id: "f2", type: "newsletter", recipients: ["a@b.example"] },
          ],
        },
      ],
      global: "55555555-5555-4555-8555-555555555555",
    } as unknown as PageRow;
    return { pageType, rows: [row(), second], css };
  };
  const cleaned = (l: PageLayout, trusted = false) => sanitizeTemplate("page", l, from, trusted) as PageLayout;
  const ids = (l: PageLayout) => l.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => b.id)));

  it("reads the blocks of every row and says how many rows it has", () => {
    expect(partBlocks("page", layout())).toHaveLength(18);
    expect(templateSummary("page", layout())).toMatch(/^2 rows: text, button/);
    expect(templateSummary("page", { pageType: "page", rows: [], css: "" })).toBe("0 rows");
  });

  it("takes everything foreign out of every row", () => {
    const clean = cleaned(layout());
    expect(clean.rows.every((r) => r.global === undefined)).toBe(true);
    const second = clean.rows[1].columns[0].blocks;
    expect(second.find((b) => b.id === "r2")?.global).toBeUndefined();
    expect(JSON.stringify(second.find((b) => b.id === "r2"))).not.toContain("link");
    expect((second.find((b) => b.id === "f2") as { recipients: string[] }).recipients).toEqual([]);
    expect(partBlocks("row", clean.rows[0]).find((b) => b.id === "b2")).toMatchObject({ href: "" });
    expect(clean.rows[0].columns[0].link).toBeUndefined();
    expect(pageLayoutSchema.safeParse(clean).error?.issues).toBeUndefined();
  });

  it("keeps the ids, the page type and the order, and does not change what it was given", () => {
    const original = layout("header");
    const before = JSON.stringify(original);
    const clean = cleaned(original);
    expect(clean.pageType).toBe("header");
    expect(ids(clean)).toEqual(ids(original));
    expect(clean.rows.map((r) => r.id)).toEqual(["row1", "row2"]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("keeps site parts and product parts: a layout is only for pages of its own kind", () => {
    const blocks = cleaned(layout("header")).rows[1].columns[0].blocks;
    expect(blocks.find((b) => b.id === "s1")).toEqual({ id: "s1", type: "site", part: "logo" });
    expect(blocks.find((b) => b.id === "p1")).toMatchObject({ type: "product", part: "title" });
  });

  it("empties another owner's HTML in every row, but not Kaizen's", () => {
    const html = (l: PageLayout) => partBlocks("page", l).find((b) => b.id === "b10") as { html: string };
    expect(html(cleaned(layout())).html).toBe("");
    expect(html(cleaned(layout(), true)).html).toBe("<script>track()</script>");
  });

  it("keeps clean CSS and empties CSS that does not pass or reaches into Storage", () => {
    expect(cleaned(layout()).css).toBe(".hero { color: red; }");
    expect(cleaned(layout("page", "")).css).toBe("");
    expect(cleaned(layout("page", "</style><script>")).css).toBe("");
    expect(cleaned(layout("page", `.a { background: url("${PUBLIC}/product-media/${from.id}/bg.webp"); }`)).css).toBe(
      "",
    );
    expect(cleaned(layout("page", "@import url(https://evil.example/a.css);")).css).toBe("");
  });

  it("collects the media of every row, once each, and maps them all", () => {
    const urls = templateMediaUrls("page", layout());
    expect(urls).toHaveLength(8);
    expect(urls.some((url) => url.endsWith("/second.webp"))).toBe(true);
    const mapped = mapTemplateMedia("page", layout(), (url) => url.replace(from.id ?? "", "new-store")) as PageLayout;
    expect(leftoverStorageUrls(mapped).every((url) => url.includes("new-store"))).toBe(true);
    expect(leftoverStorageUrls(mapped)).toHaveLength(8);
    const left = mapTemplateMedia("page", cleaned(layout()), () => null) as PageLayout;
    expect(leftoverStorageUrls(left)).toEqual([]);
    expect(pageLayoutSchema.safeParse(left).error?.issues).toBeUndefined();
  });
});

describe("a picture's own size in a template (D151)", () => {
  // Right from computers, centred below (D179: the base value and an override).
  const sized = (): PageBlock =>
    ({
      id: "sz1",
      type: "image",
      image: { url: `${PUBLIC}/product-media/${from.id}/sized.webp`, width: 800, height: 600, alt: "A cup" },
      caption: "Our cup",
      shape: "square",
      maxWidth: 300,
      align: "right",
      at: { md: { align: "center" } },
      bind: { fieldId: "f_abcdef" },
    }) as PageBlock;
  const inRow = (block: PageBlock): PageRow => ({ id: "rowSz", type: "row", layout: "1", columns: [{ id: "colSz", blocks: [block] }] });
  const kept = { maxWidth: 300, align: "right", at: { md: { align: "center" } }, shape: "square", caption: "Our cup" };

  it("is kept when a part is made ready for another store, which only loses the binding", () => {
    for (const [kind, content] of [
      ["block", sized()],
      ["row", inRow(sized())],
    ] as const) {
      const clean = sanitizeTemplate(kind, content, from);
      const block = partBlocks(kind, clean)[0] as unknown as Record<string, unknown>;
      expect(block, kind).toMatchObject(kept);
      expect(block.bind, kind).toBeUndefined();
    }
    const layout = sanitizeTemplate("page", { pageType: "page", rows: [inRow(sized())], css: "" } satisfies PageLayout, from) as PageLayout;
    expect(layout.rows[0].columns[0].blocks[0]).toMatchObject(kept);
  });

  it("is kept with the copy's address when the picture is copied", () => {
    const mapped = mapTemplateMedia("row", sanitizeTemplate("row", inRow(sized()), from), (url) => url.replace(from.id ?? "", "new-store")) as PageRow;
    const block = mapped.columns[0].blocks[0];
    expect(block).toMatchObject({ ...kept, image: { url: expect.stringContaining("new-store"), width: 800, height: 600 } });
    expect(leftoverStorageUrls(mapped)).toHaveLength(1);
  });

  it("is kept when the picture could not be copied, so the empty block is drawn as the owner placed it once it has one", () => {
    const mapped = mapTemplateMedia("row", sanitizeTemplate("row", inRow(sized()), from), () => null) as PageRow;
    const block = mapped.columns[0].blocks[0];
    expect(block).toMatchObject({ type: "image", image: null, ...kept });
    expect(leftoverStorageUrls(mapped)).toEqual([]);
    const single = mapTemplateMedia("block", sanitizeTemplate("block", sized(), from), () => null);
    expect(single).toMatchObject({ image: null, ...kept });
  });

  it("is still accepted, and kept, by the schemas a template is saved and read through", () => {
    const clean = sanitizeTemplate("row", inRow(sized()), from) as PageRow;
    const parsed = pageRowSchema.safeParse(clean);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data?.columns[0].blocks[0]).toMatchObject(kept);
    const column = pageColumnSchema.safeParse(clean.columns[0]);
    expect(column.data?.blocks[0]).toMatchObject(kept);
    // Also when the picture is gone: the empty block with its width is a valid block.
    const empty = mapTemplateMedia("row", clean, () => null) as PageRow;
    expect(pageRowSchema.safeParse(empty).data?.columns[0].blocks[0]).toMatchObject({ image: null, maxWidth: 300, align: "right" });
    const layout = pageLayoutSchema.safeParse({ pageType: "page", rows: [clean], css: "" });
    expect(layout.error?.issues).toBeUndefined();
    expect(layout.data?.rows[0].columns[0].blocks[0]).toMatchObject(kept);
  });

  it("does not change what it was given", () => {
    const original = inRow(sized());
    const before = JSON.stringify(original);
    mapTemplateMedia("row", sanitizeTemplate("row", original, from), () => null);
    expect(JSON.stringify(original)).toBe(before);
  });
});
