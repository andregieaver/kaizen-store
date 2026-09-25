import { describe, expect, it } from "vitest";

import {
  RESERVED_PAGE_SLUGS,
  RESERVED_STORE_PAGE_SLUGS,
  reservedPageSlugs,
  blockHasContent,
  frameStyle,
  spacingStyle,
  cleanRichText,
  isLinkAddress,
  newPageContent,
  pageExcerpt,
  pageInput,
  pageSlugFromTitle,
  pageSlugProblem,
  richTextPlain,
  type RichTextDoc,
} from "./page-content";
import { newBlock } from "./page-rows";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks && { marks }) }] });

describe("link addresses", () => {
  it("takes web, mail and phone addresses, site paths and anchors", () => {
    for (const href of ["https://kaizen.no", "http://example.com/a?b=c", "mailto:hei@kaizen.no", "tel:+4712345678", "/sign-up", "#pricing"]) {
      expect(isLinkAddress(href), href).toBe(true);
    }
  });

  it("refuses scripts, other protocols and addresses to another site without a scheme", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "ftp://x", "", "https://a b"]) {
      expect(isLinkAddress(href), href).toBe(false);
    }
  });
});

describe("rich text", () => {
  it("keeps what the editor offers and drops unknown attributes", () => {
    const cleaned = cleanRichText(
      doc(
        { type: "heading", attrs: { level: 2, id: "x" }, content: [{ type: "text", text: "Hei" }] },
        p("bold", [{ type: "bold" }, { type: "link", attrs: { href: "https://kaizen.no", target: "_blank", class: "x" } }]),
        { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [p("three")] }] },
        { type: "blockquote", content: [p("quote")] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
      ),
    );
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.doc.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hei" }] });
    expect(cleaned.doc.content[1]).toEqual(
      p("bold", [{ type: "bold" }, { type: "link", attrs: { href: "https://kaizen.no" } }]),
    );
    expect(cleaned.doc.content[3]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  });

  it("refuses scripts in links, unknown blocks and marks, and wrong heading levels", () => {
    expect(cleanRichText(doc(p("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "image", attrs: { src: "https://x" } }))).toMatchObject({ ok: false });
    expect(cleanRichText(doc(p("x", [{ type: "code" }])))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "heading", attrs: { level: 1 }, content: [] }))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "paragraph", content: [{ type: "text", text: 5 }] }))).toMatchObject({ ok: false });
    expect(cleanRichText("<p>hi</p>")).toMatchObject({ ok: false });
  });

  it("refuses documents nested too deeply or too long", () => {
    let node: unknown = p("deep");
    for (let i = 0; i < 20; i++) node = { type: "blockquote", content: [node] };
    expect(cleanRichText(doc(node))).toMatchObject({ ok: false, problem: expect.stringMatching(/nested/) });
    expect(cleanRichText(doc(p("x".repeat(50_001))))).toMatchObject({ ok: false });
  });

  it("gives an empty document one empty paragraph", () => {
    expect(cleanRichText(doc())).toEqual({ ok: true, doc: { type: "doc", content: [{ type: "paragraph" }] } });
  });

  it("reads the words, one line per block", () => {
    const text = richTextPlain(
      doc(p("First"), { type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] }, { type: "horizontalRule" }) as RichTextDoc,
    );
    expect(text).toBe("First\nitem");
  });
});

describe("page addresses", () => {
  it("suggests an address from the title", () => {
    expect(pageSlugFromTitle("Om oss & våre priser")).toBe("om-oss-vare-priser");
    expect(pageSlugFromTitle("Admin")).toBe("admin-page");
    expect(pageSlugFromTitle("")).toBe("");
  });

  it("says why an address cannot be used", () => {
    expect(pageSlugProblem("about")).toBeNull();
    expect(pageSlugProblem("")).toMatch(/address/);
    expect(pageSlugProblem("About")).toMatch(/lowercase/);
    expect(pageSlugProblem("a--b")).toMatch(/single hyphens/);
    for (const slug of RESERVED_PAGE_SLUGS) expect(pageSlugProblem(slug)).toMatch(/used by Kaizen/);
  });
});

describe("page input", () => {
  const row = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "r1",
    type: "row",
    layout: "1",
    columns: [{ id: "c1", blocks }],
    ...extra,
  });
  const valid = {
    ...newPageContent(),
    title: " About Kaizen ",
    slug: "about",
    rows: [row([{ id: "b1", type: "richText", doc: doc(p("Hello there")) }])],
  };

  it("accepts a page and trims its texts", () => {
    const parsed = pageInput.parse(valid);
    expect(parsed.title).toBe("About Kaizen");
    expect(pageExcerpt(parsed)).toBe("Hello there");
  });

  it("names every problem", () => {
    const result = pageInput.safeParse({
      ...valid,
      title: "",
      slug: "Sign Up",
      thumbnail: { url: "javascript:alert(1)", width: 10, height: 10, alt: "" },
      rows: [
        row([
          { id: "b1", type: "richText", doc: doc(p("x", [{ type: "link", attrs: { href: "javascript:x" } }])) },
          { id: "b1", type: "richText", doc: doc(p("y")) },
        ]),
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/title/);
    expect(messages).toMatch(/lowercase letters/);
    expect(messages).toMatch(/picture/);
    expect(messages).toMatch(/not a link address/);
  });

  it("refuses unknown block types, unknown layouts and rows with the wrong number of columns", () => {
    expect(pageInput.safeParse({ ...valid, rows: [row([{ id: "x", type: "html", html: "<script>" }])] }).success).toBe(false);
    expect(pageInput.safeParse({ ...valid, rows: [row([], { layout: "7" })] }).success).toBe(false);
    expect(pageInput.safeParse({ ...valid, rows: [row([], { layout: "2" })] }).success).toBe(false);
  });

  it("names two parts with one id", () => {
    const result = pageInput.safeParse({ ...valid, rows: [row([]), row([], { columns: [{ id: "c2", blocks: [] }] })] });
    expect(result.error?.issues.map((i) => i.message)).toContain(
      "Two parts of the page have the same id. Reload the page and try again.",
    );
  });

  it("reads a page saved before rows as one row with one column", () => {
    const { rows: _rows, ...legacy } = valid;
    void _rows;
    const parsed = pageInput.parse({ ...legacy, blocks: [{ id: "b1", type: "richText", doc: doc(p("Old")) }] });
    expect(parsed.rows).toEqual([
      { id: "legacy-row", type: "row", layout: "1", columns: [{ id: "legacy-column", blocks: [expect.objectContaining({ id: "b1" })] }] },
    ]);
    expect(pageExcerpt(parsed)).toBe("Old");
  });
});

describe("pictures and spacing (D47)", () => {
  const page = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
    ...newPageContent(),
    title: "Pictures",
    slug: "pictures",
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks, ...extra }] }],
  });
  const picture = { url: "https://example.com/a.webp", width: 1600, height: 900, alt: "A lamp" };

  it("keeps a picture block, with or without a picture yet", () => {
    const parsed = pageInput.parse(
      page([
        { id: "i1", type: "image", image: picture, caption: " On the desk " },
        { id: "i2", type: "image", image: null },
      ]),
    );
    const blocks = parsed.rows[0].columns[0].blocks;
    expect(blocks[0]).toMatchObject({ type: "image", caption: "On the desk" });
    expect(blocks[1]).toMatchObject({ type: "image", image: null, caption: "" });
    expect(blocks.map(blockHasContent)).toEqual([true, false]);
    expect(pageExcerpt(parsed)).toBe("A lamp On the desk");
  });

  it("refuses a picture that is not on the web", () => {
    expect(pageInput.safeParse(page([{ id: "i", type: "image", image: { ...picture, url: "javascript:alert(1)" } }])).success).toBe(false);
  });

  it("keeps margin and padding in whole pixels from 0 to 240, and turns them into CSS", () => {
    const sides = { top: 8, right: 0, bottom: 24, left: 0 };
    const parsed = pageInput.parse(page([], { style: { margin: sides, padding: sides } }));
    expect(parsed.rows[0].columns[0].style).toEqual({ margin: sides, padding: sides });
    expect(spacingStyle({ margin: sides })).toEqual({ marginTop: "8px", marginBottom: "24px" });
    expect(spacingStyle(undefined)).toEqual({});
    for (const bad of [-4, 241, 2.5]) {
      expect(pageInput.safeParse(page([], { style: { margin: { ...sides, top: bad } } })).success).toBe(false);
    }
  });
});

describe("row, column and component settings (D48)", () => {
  const block = { id: "b1", type: "richText", doc: doc(p("Hei")) };
  const page = (row: Record<string, unknown> = {}, column: Record<string, unknown> = {}, blocks: unknown[] = [block]) => ({
    ...newPageContent(),
    title: "Settings",
    slug: "settings",
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks, ...column }], ...row }],
  });
  const problems = (value: unknown) => {
    const parsed = pageInput.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };

  it("keeps a row's width, height, order, column heights and background", () => {
    const settings = {
      width: "full",
      contentWidth: "content",
      fullHeight: true,
      reverseOnMobile: true,
      equalHeight: true,
      align: "middle",
      background: { type: "image", image: { url: "https://example.com/b.webp", width: 1600, height: 900 }, overlay: { color: "#000000", opacity: 40 } },
    };
    expect(pageInput.parse(page(settings)).rows[0]).toMatchObject(settings);
    expect(problems(page({ width: "wide" }))).not.toEqual([]);
    expect(problems(page({ background: { type: "color", color: "red" } }))).toEqual([
      "A colour is written as # and six hex digits, like #1f2937.",
    ]);
    expect(problems(page({ background: { type: "image", image: { url: "javascript:x", width: 1, height: 1 }, overlay: null } }))).not.toEqual([]);
    expect(problems(page({ background: { type: "image", image: { url: "https://e.com/a", width: 1, height: 1 }, overlay: { color: "#000000", opacity: 101 } } }))).not.toEqual([]);
  });

  it("keeps a column's link when its address is safe", () => {
    expect(pageInput.parse(page({}, { link: { href: " /sign-up " } })).rows[0].columns[0].link).toEqual({ href: "/sign-up", label: "" });
    for (const href of ["", "javascript:alert(1)", "//evil.example"]) {
      expect(problems(page({}, { link: { href, label: "" } })), href).toEqual([
        "A column's link needs an address: https://…, a page like /about, mailto: or tel:.",
      ]);
    }
  });

  it("keeps text alignment by screen and a picture's shape", () => {
    const aligned = { ...block, align: { mobile: "center", desktop: "right" } };
    const picture = { id: "i1", type: "image", image: null, caption: "", shape: "circle" };
    const blocks = pageInput.parse(page({}, {}, [aligned, picture])).rows[0].columns[0].blocks;
    expect(blocks[0]).toMatchObject({ align: { mobile: "center", desktop: "right" } });
    expect(blocks[1]).toMatchObject({ shape: "circle" });
    expect(problems(page({}, {}, [{ ...block, align: { tablet: "justify" } }]))).not.toEqual([]);
    expect(problems(page({}, {}, [{ ...picture, shape: "oval" }]))).not.toEqual([]);
  });

  it("takes ids and classes, tidied, and drops empty ones", () => {
    const parsed = pageInput.parse(page({ htmlId: " prices ", className: "  hero   dark " }, { htmlId: "", className: " " }));
    expect(parsed.rows[0]).toMatchObject({ htmlId: "prices", className: "hero dark" });
    expect(parsed.rows[0].columns[0].htmlId).toBeUndefined();
    expect(parsed.rows[0].columns[0].className).toBeUndefined();
    expect(problems(page({ htmlId: "1st" }))[0]).toMatch(/^An id starts with a letter/);
    expect(problems(page({ htmlId: "two words" }))[0]).toMatch(/^An id starts with a letter/);
    expect(problems(page({ htmlId: "main" }))).toEqual(['The id "main" is used by the site itself. Choose another.']);
    expect(problems(page({ className: 'a" onclick="x' }))[0]).toMatch(/without quotes/);
  });

  it("refuses the same id on two parts of a page", () => {
    expect(problems(page({ htmlId: "same" }, { htmlId: "same" }))).toEqual([
      'Two parts of the page have the id "same". Give each its own.',
    ]);
  });
});

describe("borders, corners and shadows; headings and buttons (D49)", () => {
  const page = (blocks: unknown[], column: Record<string, unknown> = {}) => ({
    ...newPageContent(),
    title: "Parts",
    slug: "parts",
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks, ...column }] }],
  });
  const problems = (value: unknown) => {
    const parsed = pageInput.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  const heading = (id: string, level: number, text = "Prices") => ({ id, type: "heading", text, level });
  const button = (extra: Record<string, unknown> = {}) => ({ id: "btn", type: "button", label: "Start", href: "/sign-up", ...extra });

  it("keeps a border, rounded corners and a shadow, within limits, and turns them into CSS", () => {
    const frame = { border: { width: { top: 1, right: 2, bottom: 1, left: 0 }, color: "#d1d5db", style: "dashed" }, radius: 12, shadow: "md" };
    expect(pageInput.parse(page([], frame)).rows[0].columns[0]).toMatchObject(frame);
    expect(frameStyle(frame as never)).toEqual({
      borderStyle: "dashed",
      borderColor: "#d1d5db",
      borderTopWidth: "1px",
      borderRightWidth: "2px",
      borderBottomWidth: "1px",
      borderLeftWidth: "0px",
      borderRadius: "12px",
      boxShadow: "0 4px 12px rgb(0 0 0 / 0.12)",
    });
    expect(frameStyle({})).toEqual({});
    expect(problems(page([], { border: { ...frame.border, width: { ...frame.border.width, top: 21 } } }))).toEqual([
      "Keep a border at 20 pixels or less.",
    ]);
    expect(problems(page([], { border: { ...frame.border, style: "double" } }))).not.toEqual([]);
    expect(problems(page([], { radius: 201 }))).toEqual(["Keep rounded corners at 200 pixels or less."]);
    expect(problems(page([], { shadow: "huge" }))).not.toEqual([]);
  });

  it("keeps headings with their look, shows them once written, and counts their words", () => {
    const styled = { ...heading("h", 2, " Our prices "), size: "2xl", weight: "bold", textColor: "#112233", align: { mobile: "center" } };
    const parsed = pageInput.parse(page([styled, heading("e", 3, "")]));
    const [first, empty] = parsed.rows[0].columns[0].blocks;
    expect(first).toMatchObject({ text: "Our prices", level: 2, size: "2xl", weight: "bold", textColor: "#112233" });
    expect([first, empty].map(blockHasContent)).toEqual([true, false]);
    expect(pageExcerpt(parsed)).toBe("Our prices");
    expect(problems(page([heading("x", 7)]))).toEqual(["A heading has an unknown level."]);
    expect(problems(page([{ ...heading("x", 2), size: "giant" }]))).not.toEqual([]);
  });

  it("takes one main heading (H1) per page", () => {
    expect(problems(page([heading("a", 1)]))).toEqual([]);
    expect(problems(page([heading("a", 1), heading("b", 1)]))).toEqual([
      "A page has one main heading (H1). Make the others H2 or smaller.",
    ]);
  });

  it("keeps a button, shown once it has text and a safe address, and leaves its words out of the excerpt", () => {
    const styled = button({ variant: "outline", size: "lg", shape: "pill", fullWidth: true, newTab: true, fill: "#1d4ed8", textColor: "#ffffff" });
    const parsed = pageInput.parse(page([styled, button({ id: "draft", href: "" })]));
    const [ready, draft] = parsed.rows[0].columns[0].blocks;
    expect(ready).toMatchObject({ variant: "outline", size: "lg", shape: "pill", fullWidth: true, newTab: true });
    expect([ready, draft].map(blockHasContent)).toEqual([true, false]);
    expect(pageExcerpt(parsed)).toBe("");
    for (const href of ["javascript:alert(1)", "//evil.example"]) {
      expect(problems(page([button({ href })])), href).toEqual([
        "A button's address must be https://…, a page like /about, mailto: or tel:.",
      ]);
    }
    expect(problems(page([button({ variant: "ghost" })]))).not.toEqual([]);
  });
});

describe("content grids (D51)", () => {
  const page = (grid: Record<string, unknown>) => ({
    ...newPageContent(),
    title: "Grid",
    slug: "grid",
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ ...newBlock("contentGrid", () => "g1"), ...grid }] }] }],
  });
  const problems = (value: unknown) => {
    const parsed = pageInput.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };

  it("starts as a grid of pages that passes the checks, shown whatever it finds", () => {
    const parsed = pageInput.parse(page({}));
    const grid = parsed.rows[0].columns[0].blocks[0];
    expect(grid).toMatchObject({ type: "contentGrid", source: { type: "pages" }, limit: 6, columns: { mobile: 1, tablet: 2, desktop: 3 } });
    expect(blockHasContent(grid)).toBe(true);
    expect(pageExcerpt(parsed)).toBe("");
  });

  it("keeps a grid of a store's products, filtered, sorted and styled", () => {
    const grid = {
      source: { type: "products", storeId: "00000000-0000-4000-8000-000000000001", market: "NO" },
      categories: ["00000000-0000-4000-8000-000000000002"],
      sort: "priceLow",
      limit: 12,
      columns: { mobile: 2, tablet: 3, desktop: 6 },
      imageShape: "square",
      button: { variant: "outline" },
      tile: { background: "#ffffff", padding: 16, radius: 8, shadow: "sm" },
    };
    expect(pageInput.parse(page(grid)).rows[0].columns[0].blocks[0]).toMatchObject(grid);
  });

  it("refuses an unknown source, too many items or columns, and a tile heading at H1", () => {
    expect(problems(page({ source: { type: "videos" } }))).toEqual(["A content grid shows an unknown kind of content."]);
    expect(problems(page({ source: { type: "products", storeId: "x", market: "NO" } }))).toEqual([
      "Choose the store whose products the grid shows.",
    ]);
    expect(problems(page({ limit: 49 }))).toEqual(["A grid shows at most 48 items."]);
    expect(problems(page({ limit: 0 }))).toEqual(["A grid shows at least one item."]);
    expect(problems(page({ columns: { mobile: 3, tablet: 2, desktop: 3 } }))).not.toEqual([]);
    expect(problems(page({ columns: { mobile: 1, tablet: 2, desktop: 7 } }))).not.toEqual([]);
    expect(problems(page({ headingLevel: 1 }))).toEqual(["A tile's heading has an unknown level."]);
    expect(problems(page({ gap: 97 }))).toEqual(["Keep the space between tiles at 96 pixels or less."]);
  });
});

describe("addresses by owner (D53)", () => {
  it("keeps Kaizen's routes from Kaizen's pages, and a store's routes from its pages", () => {
    expect(pageSlugProblem("sign-up")).toMatch(/used by Kaizen/);
    expect(pageSlugProblem("sign-up", reservedPageSlugs("store-id"))).toBeNull();
    expect(pageSlugProblem("cart", reservedPageSlugs("store-id"))).toMatch(/used by the store/);
    expect(pageSlugProblem("cart", reservedPageSlugs(null))).toBeNull();
    expect(pageSlugFromTitle("Cart", RESERVED_STORE_PAGE_SLUGS)).toBe("cart-page");
    // What the builder saves is read whoever owns it: the address rules are the owner's.
    expect(pageInput.safeParse({ ...newPageContent(), title: "Help", slug: "help" }).success).toBe(true);
  });
});

describe("article addresses (D57)", () => {
  it("keep the blog's own routes from articles, and the blog's address from pages", () => {
    expect(pageSlugProblem("blog")).toMatch(/used by Kaizen/);
    expect(pageSlugProblem("blog", reservedPageSlugs("store-id"))).toMatch(/used by the store/);
    for (const owner of [null, "store-id"]) {
      expect(pageSlugProblem("tag", reservedPageSlugs(owner, "article"))).toBe(
        "The address blog/tag is used by the blog itself. Choose another.",
      );
      // An article may be called what a page may not.
      expect(pageSlugProblem("sign-up", reservedPageSlugs(owner, "article"))).toBeNull();
    }
    expect(pageInput.safeParse({ ...newPageContent(), title: "News", slug: "news", author: "Kari" }).success).toBe(true);
    expect(pageInput.safeParse({ ...newPageContent(), title: "News", slug: "news", author: "x".repeat(101) }).success).toBe(false);
  });
});

describe("a store's reserved addresses (D53)", () => {
  it("cover every route inside a store's market", async () => {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(new URL("../app/s/[store]/[market]/", import.meta.url), { withFileTypes: true });
    const routes = entries.filter((e) => e.isDirectory() && !e.name.startsWith("[") && !e.name.startsWith("(")).map((e) => e.name);
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) expect(RESERVED_STORE_PAGE_SLUGS, route).toContain(route);
  });
});
