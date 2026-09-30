import { describe, expect, it } from "vitest";

import { pageColumnSchema, pageRowSchema, type PageBlock, type PageRow } from "./page-content";
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
