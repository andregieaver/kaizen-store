import { describe, expect, it } from "vitest";

import {
  BOUND_PICTURE_SIZE,
  IMAGE_SHAPES,
  IMAGE_SHAPE_RATIO,
  IMAGE_WIDTH_MAX,
  IMAGE_WIDTH_MIN,
  RESERVED_PAGE_SLUGS,
  RESERVED_STORE_PAGE_SLUGS,
  reservedPageSlugs,
  blockFonts,
  blockHasContent,
  blockText,
  frameStyle,
  imageDisplaySize,
  parsePageContent,
  samePageContent,
  rowSpacing,
  spacingStyle,
  cleanRichText,
  isLinkAddress,
  newPageContent,
  pageExcerpt,
  pageFonts,
  pageInput,
  pageSlugFromTitle,
  pageSlugProblem,
  richTextPlain,
  type ImageShape,
  type RichTextDoc,
} from "./page-content";
import { newBlock } from "./page-rows";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks && { marks }) }] });

describe("link addresses", () => {
  it("takes web, mail and phone addresses, site paths and anchors", () => {
    for (const href of ["https://kaizen.no", "http://example.com/a?b=c", "mailto:hei@kaizen.no", "tel:+4712345678", "/sign-up", "#pricing", "#", "#section.2", "#modal-promo"]) {
      expect(isLinkAddress(href), href).toBe(true);
    }
  });

  it("refuses scripts, other protocols and addresses to another site without a scheme", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "ftp://x", "", "https://a b", "# a"]) {
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

  it("keeps the page's own CSS when it can be used, and says why when not (D100)", () => {
    expect(pageInput.parse({ ...valid, css: "  h1 { color: red; }  " }).css).toBe("h1 { color: red; }");
    expect(pageInput.parse({ ...valid, css: "   " }).css).toBeUndefined();
    const bad = pageInput.safeParse({ ...valid, css: "h1 {} </style><script>" });
    expect(bad.error?.issues.map((i) => i.message)).toEqual([expect.stringMatching(/^Custom CSS: CSS cannot contain "</)]);
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
    expect(pageInput.safeParse({ ...valid, rows: [row([{ id: "x", type: "iframe", src: "https://example.com" }])] }).success).toBe(false);
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

  describe("how big a picture is drawn (D151)", () => {
    const sized = (width: number, height: number) => ({ url: "https://example.com/a.webp", width, height, alt: "" });
    const size = (width: number, height: number, rest: { shape?: ImageShape; maxWidth?: number } = {}) =>
      imageDisplaySize({ image: sized(width, height), ...rest });

    it("is nothing without a picture, whatever else is set", () => {
      expect(imageDisplaySize({ image: null })).toBeNull();
      expect(imageDisplaySize({ image: null, shape: "circle", maxWidth: 300 })).toBeNull();
    });

    it("is the picture's own size when there is no shape and no width", () => {
      expect(size(800, 600)).toEqual({ width: 800, height: 600 });
      expect(size(1600, 900)).toEqual({ width: 1600, height: 900 });
      // Odd sizes survive the ratio's rounding exactly: the stored size is what is drawn.
      for (const [width, height] of [[1000, 333], [1234, 567], [333, 1000], [1599, 1201], [10_000, 1], [1, 10_000]]) {
        expect(size(width, height), `${width}x${height}`).toEqual({ width, height });
      }
    });

    it("makes a picture narrower with maxWidth, keeping its proportions", () => {
      expect(size(800, 600, { maxWidth: 300 })).toEqual({ width: 300, height: 225 });
      expect(size(1600, 900, { maxWidth: 333 })).toEqual({ width: 333, height: 187 });
      expect(size(600, 800, { maxWidth: 150 })).toEqual({ width: 150, height: 200 });
    });

    it("never makes a picture larger than its own size, whatever maxWidth says", () => {
      expect(size(800, 600, { maxWidth: 5000 })).toEqual({ width: 800, height: 600 });
      expect(size(800, 600, { maxWidth: 801 })).toEqual({ width: 800, height: 600 });
      expect(size(800, 600, { maxWidth: 800 })).toEqual({ width: 800, height: 600 });
      // A crop's own size is the crop's, not the picture's.
      expect(size(1600, 900, { shape: "circle", maxWidth: 1600 })).toEqual({ width: 900, height: 900 });
    });

    it("draws a crop at the largest crop of that shape inside the picture", () => {
      expect(size(1600, 900, { shape: "circle" })).toEqual({ width: 900, height: 900 });
      expect(size(1600, 900, { shape: "square" })).toEqual({ width: 900, height: 900 });
      expect(size(1600, 900, { shape: "landscape" })).toEqual({ width: 1200, height: 900 });
      expect(size(1600, 900, { shape: "portrait" })).toEqual({ width: 675, height: 900 });
      expect(size(1600, 400, { shape: "panorama" })).toEqual({ width: 1200, height: 400 });
      // The other way round, the width is the limit.
      expect(size(600, 800, { shape: "landscape" })).toEqual({ width: 600, height: 450 });
      expect(size(600, 800, { shape: "portrait" })).toEqual({ width: 600, height: 800 });
      expect(size(800, 600, { shape: "panorama" })).toEqual({ width: 800, height: 267 });
    });

    it("never draws a crop larger than the picture it is cut from", () => {
      for (const [width, height] of [[800, 600], [600, 800], [1600, 900], [900, 1600], [1600, 400], [400, 1600], [1000, 1000], [10_000, 10_000]]) {
        for (const shape of Object.keys(IMAGE_SHAPES) as ImageShape[]) {
          const drawn = size(width, height, { shape })!;
          expect(drawn.width, `${shape} ${width}x${height}`).toBeLessThanOrEqual(width);
          expect(drawn.height, `${shape} ${width}x${height}`).toBeLessThanOrEqual(height);
          // And it is the largest one: it fills the picture in one direction.
          expect(drawn.width === width || drawn.height === height, `${shape} ${width}x${height} fills one side`).toBe(true);
          expect(drawn.width / drawn.height).toBeCloseTo(IMAGE_SHAPE_RATIO[shape], 1);
        }
      }
    });

    it("applies maxWidth to a crop's own width, with the crop's proportions", () => {
      expect(size(1600, 900, { shape: "circle", maxWidth: 300 })).toEqual({ width: 300, height: 300 });
      expect(size(1600, 900, { shape: "landscape", maxWidth: 600 })).toEqual({ width: 600, height: 450 });
      expect(size(1600, 900, { shape: "circle", maxWidth: 1000 })).toEqual({ width: 900, height: 900 });
    });

    it("is at least one pixel in each direction", () => {
      expect(size(1, 1)).toEqual({ width: 1, height: 1 });
      expect(size(1, 1, { shape: "panorama" })).toEqual({ width: 1, height: 1 });
      expect(size(3, 1, { shape: "panorama" })).toEqual({ width: 3, height: 1 });
    });

    it("can be as narrow as the least a picture is allowed to be", () => {
      expect(size(800, 600, { maxWidth: IMAGE_WIDTH_MIN })).toEqual({ width: 16, height: 12 });
      expect(size(1600, 900, { maxWidth: IMAGE_WIDTH_MIN })).toEqual({ width: 16, height: 9 });
    });
  });

  describe("a picture's width and place (D151)", () => {
    const problems = (value: unknown) => {
      const parsed = pageInput.safeParse(value);
      return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
    };
    const image = (extra: Record<string, unknown> = {}) => ({ id: "i1", type: "image", image: picture, caption: "", ...extra });
    const firstBlock = (value: unknown) => pageInput.parse(value).rows[0].columns[0].blocks[0] as unknown as Record<string, unknown>;

    it("keeps how wide a picture is drawn and where it sits, by screen size (D179: read from the screens it was saved by)", () => {
      const block = firstBlock(page([image({ maxWidth: 300, align: { mobile: "center", desktop: "right" } })]));
      // Right from computers (Large and Extra large), centred on tablets and phones, which hold only what differs.
      expect(block).toMatchObject({ type: "image", maxWidth: 300, align: "right", at: { md: { align: "center" } } });
      expect(block.at).toEqual({ md: { align: "center" } });
      // On a picture not set yet too: the width is the owner's choice, not the picture's.
      expect(firstBlock(page([image({ image: null, maxWidth: 120, align: { tablet: "left" } })]))).toMatchObject({
        image: null,
        maxWidth: 120,
        align: "left",
      });
      // The new shape is kept as it is.
      expect(firstBlock(page([image({ align: "center", at: { sm: { align: "left", maxWidth: 80 } } })]))).toMatchObject({ align: "center", at: { sm: { align: "left", maxWidth: 80 } } });
    });

    it("takes a picture from the least to the most a picture can be wide", () => {
      expect(IMAGE_WIDTH_MIN).toBe(16);
      expect(IMAGE_WIDTH_MAX).toBe(10_000);
      for (const ok of [IMAGE_WIDTH_MIN, 17, 300, 1600, IMAGE_WIDTH_MAX]) {
        expect(problems(page([image({ maxWidth: ok })])), String(ok)).toEqual([]);
        expect(firstBlock(page([image({ maxWidth: ok })])).maxWidth).toBe(ok);
      }
      // The most is what a picture's own width is allowed to be.
      expect(problems(page([image({ image: { ...picture, width: IMAGE_WIDTH_MAX } })]))).toEqual([]);
      expect(problems(page([image({ image: { ...picture, width: IMAGE_WIDTH_MAX + 1 } })]))).not.toEqual([]);
    });

    it("says why a width cannot be used", () => {
      const tooNarrow = "Make a picture at least 16 pixels wide.";
      const tooWide = "Keep a picture at most 10000 pixels wide.";
      const fraction = "A picture's width is whole pixels.";
      expect(problems(page([image({ maxWidth: 0 })]))).toEqual([tooNarrow]);
      expect(problems(page([image({ maxWidth: 15 })]))).toEqual([tooNarrow]);
      expect(problems(page([image({ maxWidth: -300 })]))).toEqual([tooNarrow]);
      expect(problems(page([image({ maxWidth: 10_001 })]))).toEqual([tooWide]);
      expect(problems(page([image({ maxWidth: 2.5 })]))).toEqual([fraction]);
      expect(problems(page([image({ maxWidth: 300.5 })]))).toEqual([fraction]);
    });

    it("refuses a width that is not a number", () => {
      for (const bad of ["300", "", null, Number.NaN, {}, [300], true]) {
        const found = pageInput.safeParse(page([image({ maxWidth: bad })]));
        expect(found.success, String(bad)).toBe(false);
        expect(found.error?.issues.map((i) => i.path.join(".")), String(bad)).toEqual(["rows.0.columns.0.blocks.0.maxWidth"]);
      }
      expect(problems(page([image({ maxWidth: "300" })]))[0]).toMatch(/expected number/);
    });

    it("refuses a place that is not left, centre or right, on any screen", () => {
      for (const screen of ["mobile", "tablet", "desktop"]) {
        expect(problems(page([image({ align: { [screen]: "justify" } })])), screen).not.toEqual([]);
        expect(problems(page([image({ align: { [screen]: "middle" } })])), screen).not.toEqual([]);
        for (const ok of ["left", "center", "right"]) expect(problems(page([image({ align: { [screen]: ok } })])), `${screen} ${ok}`).toEqual([]);
      }
      // One place for the whole picture, with overrides by size (D179), and nothing else.
      expect(problems(page([image({ align: "center" })]))).toEqual([]);
      expect(problems(page([image({ align: "middle" })]))).not.toEqual([]);
      expect(problems(page([image({ align: "left", at: { sm: { align: "justify" } } })]))).not.toEqual([]);
    });

    it("leaves both out of a picture that has neither, so saved pages are unchanged", () => {
      const block = firstBlock(page([image()]));
      expect(block).not.toHaveProperty("maxWidth");
      expect(block).not.toHaveProperty("align");
      const stored = JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
      expect("maxWidth" in stored).toBe(false);
      expect("align" in stored).toBe(false);
      // What the editor sends for a width taken away is the key left undefined: it is dropped, not saved as something.
      const taken = firstBlock(page([image({ maxWidth: undefined, align: undefined })]));
      expect(JSON.parse(JSON.stringify(taken))).toEqual(JSON.parse(JSON.stringify(block)));
      expect("maxWidth" in JSON.parse(JSON.stringify(taken))).toBe(false);
    });

    it("keeps both through a save and a read of the stored page", () => {
      const content = pageInput.parse(page([image({ maxWidth: 300, shape: "circle", align: { mobile: "center", tablet: "left", desktop: "right" } })]));
      const stored = JSON.parse(JSON.stringify(content));
      const read = parsePageContent(stored);
      expect(read).not.toBeNull();
      expect(read?.rows[0].columns[0].blocks[0]).toMatchObject({
        type: "image",
        maxWidth: 300,
        shape: "circle",
        align: "right",
        at: { md: { align: "left" }, sm: { align: "center" } },
      });
      // Reading changes nothing: saved and read again, it is the same page.
      expect(samePageContent(read!, content)).toBe(true);
      expect(samePageContent(parsePageContent(JSON.parse(JSON.stringify(read)))!, content)).toBe(true);
    });

    it("keeps a width on a picture only, not on headings, text or buttons", () => {
      const richText = { id: "t1", type: "richText", doc: doc(p("Words")), maxWidth: 300 };
      const heading = { id: "h1", type: "heading", text: "Prices", level: 2, maxWidth: 300 };
      const button = { id: "b1", type: "button", label: "Start", href: "/sign-up", maxWidth: 300 };
      const blocks = pageInput.parse(page([richText, heading, button, image({ maxWidth: 300 })])).rows[0].columns[0].blocks;
      expect(blocks.map((b) => b.type)).toEqual(["richText", "heading", "button", "image"]);
      for (const block of blocks.slice(0, 3)) expect(block, block.type).not.toHaveProperty("maxWidth");
      expect(blocks[3]).toMatchObject({ maxWidth: 300 });
    });

    it("counts a picture not chosen yet as empty, with a width or not, and says nothing about it", () => {
      const parsed = pageInput.parse(page([image({ image: null, maxWidth: 300, align: { mobile: "center" } }), image({ id: "i2", image: null })]));
      const [sized, plain] = parsed.rows[0].columns[0].blocks;
      expect(sized).toMatchObject({ image: null, maxWidth: 300 });
      expect(blockHasContent(sized)).toBe(false);
      expect(blockHasContent(plain)).toBe(false);
      expect(blockText(sized)).toBe("");
      expect(pageExcerpt(parsed)).toBe("");
    });

    it("leaves a picture's words and whether it counts as content as they were", () => {
      const plain = pageInput.parse(page([image({ caption: "On the desk" })])).rows[0].columns[0].blocks[0];
      const set = pageInput.parse(page([image({ caption: "On the desk", maxWidth: 200, align: { mobile: "right" } })])).rows[0].columns[0].blocks[0];
      expect(blockText(set)).toBe("A lamp On the desk");
      expect(blockText(set)).toBe(blockText(plain));
      expect(blockHasContent(set)).toBe(true);
    });
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

  it("gives rows 20 px of padding until they have their own, and keeps a row set to none", () => {
    expect(spacingStyle(rowSpacing(undefined))).toEqual({ paddingTop: "20px", paddingRight: "20px", paddingBottom: "20px", paddingLeft: "20px" });
    const margin = { top: 8, right: 0, bottom: 0, left: 0 };
    expect(rowSpacing({ margin })).toEqual({ margin, padding: { top: 20, right: 20, bottom: 20, left: 20 } });
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(spacingStyle(rowSpacing({ padding: none }))).toEqual({});
    expect(pageInput.parse(page([])).rows[0].style).toBeUndefined();
    const parsed = pageInput.parse({ ...page([]), rows: [{ ...page([]).rows[0], style: { padding: none } }] });
    expect(parsed.rows[0].style).toEqual({ padding: none });
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
      equalHeight: true,
      align: "middle",
      background: { type: "image", image: { url: "https://example.com/b.webp", width: 1600, height: 900 }, overlay: { color: "#000000", opacity: 40 } },
    };
    expect(pageInput.parse(page(settings)).rows[0]).toMatchObject(settings);
    // Reversed on phones, as saved before D179: the stacked columns' order at Small.
    const reversed = pageInput.parse(page({ ...settings, reverseOnMobile: true })).rows[0];
    expect(reversed).toMatchObject({ ...settings, at: { sm: { reverse: true } } });
    expect(reversed).not.toHaveProperty("reverseOnMobile");
    expect(problems(page({ width: "wide" }))).not.toEqual([]);
    expect(problems(page({ background: { type: "color", color: "red" } }))).toEqual([
      "A colour is written as # and six hex digits, like #1f2937.",
    ]);
    expect(problems(page({ background: { type: "image", image: { url: "javascript:x", width: 1, height: 1 }, overlay: null } }))).not.toEqual([]);
    expect(problems(page({ background: { type: "image", image: { url: "https://e.com/a", width: 1, height: 1 }, overlay: { color: "#000000", opacity: 101 } } }))).not.toEqual([]);
  });

  it("keeps a row's background video, with its still, colour and blur, and gives columns none", () => {
    const video = {
      type: "video",
      video: { url: "https://e.com/page-videos/a.mp4" },
      poster: { url: "https://e.com/a.webp", width: 1280, height: 720 },
      overlay: { color: "#000000", opacity: 30 },
      blur: 4,
    };
    expect(pageInput.parse(page({ background: video })).rows[0].background).toEqual(video);
    expect(pageInput.parse(page({ background: { ...video, poster: null } })).rows[0].background).toMatchObject({ poster: null });
    expect(problems(page({}, { background: video }))).toContain("Only rows can have a background video.");
    expect(problems(page({ background: { ...video, video: { url: "javascript:alert(1)" } } }))).toContain(
      "A background video has an invalid address.",
    );
  });

  it("keeps a background picture's blur, in whole pixels from 1 to 100, on rows and columns", () => {
    const picture = { type: "image", image: { url: "https://e.com/a.webp", width: 800, height: 600 }, overlay: null };
    const parsed = pageInput.parse(page({ background: { ...picture, blur: 6 } }, { background: { ...picture, blur: 100 } }));
    expect(parsed.rows[0].background).toMatchObject({ blur: 6 });
    expect(parsed.rows[0].columns[0].background).toMatchObject({ blur: 100 });
    expect(pageInput.parse(page({ background: picture })).rows[0].background).not.toHaveProperty("blur");
    for (const bad of [0, 101, 2.5, -1]) expect(problems(page({ background: { ...picture, blur: bad } }))).not.toEqual([]);
    // What is behind a part is blurred 20 px at most.
    expect(pageInput.parse(page({ backdropBlur: 20 })).rows[0].backdropBlur).toBe(20);
    expect(problems(page({ backdropBlur: 21 }))).not.toEqual([]);
  });

  it("keeps a column's link when its address is safe", () => {
    expect(pageInput.parse(page({}, { link: { href: " /sign-up " } })).rows[0].columns[0].link).toEqual({ href: "/sign-up", label: "" });
    for (const href of ["", "javascript:alert(1)", "//evil.example"]) {
      expect(problems(page({}, { link: { href, label: "" } })), href).toEqual([
        "A column's link needs an address: https://…, a page like /about, an anchor like #contact, mailto: or tel:.",
      ]);
    }
  });

  it("keeps text alignment by screen and a picture's shape", () => {
    const aligned = { ...block, align: { mobile: "center", desktop: "right" } };
    const picture = { id: "i1", type: "image", image: null, caption: "", shape: "circle" };
    const blocks = pageInput.parse(page({}, {}, [aligned, picture])).rows[0].columns[0].blocks;
    expect(blocks[0]).toMatchObject({ align: "right", at: { md: { align: "center" } } });
    expect(blocks[1]).toMatchObject({ shape: "circle" });
    expect(problems(page({}, {}, [{ ...block, align: { tablet: "justify" } }]))).not.toEqual([]);
    expect(problems(page({}, {}, [{ ...picture, shape: "oval" }]))).not.toEqual([]);
  });

  it("has a proportion for every shape a picture can be cropped to (D151)", () => {
    // A shape added to IMAGE_SHAPES without a proportion would be drawn as NaN pixels.
    expect(Object.keys(IMAGE_SHAPE_RATIO).sort()).toEqual(Object.keys(IMAGE_SHAPES).sort());
    for (const shape of Object.keys(IMAGE_SHAPES) as ImageShape[]) {
      expect(Number.isFinite(IMAGE_SHAPE_RATIO[shape]), shape).toBe(true);
      expect(IMAGE_SHAPE_RATIO[shape], shape).toBeGreaterThan(0);
    }
    // Width over height, as the crops are named: pinned, as changing one resizes every saved picture of that shape.
    expect(IMAGE_SHAPE_RATIO).toEqual({ landscape: 4 / 3, portrait: 3 / 4, panorama: 3, square: 1, circle: 1 });
  });

  it("draws a picture of every shape at a size whose proportion is the shape's (D151)", () => {
    const image = { url: "https://example.com/a.webp", width: 1200, height: 1200, alt: "" };
    for (const shape of Object.keys(IMAGE_SHAPES) as ImageShape[]) {
      const drawn = imageDisplaySize({ image, shape })!;
      expect(Number.isNaN(drawn.width) || Number.isNaN(drawn.height), shape).toBe(false);
      expect(drawn.width / drawn.height, shape).toBeCloseTo(IMAGE_SHAPE_RATIO[shape], 2);
    }
    // The stand-in size of a picture taken from a custom field is an ordinary landscape picture, drawn at that size.
    expect(imageDisplaySize({ image: { url: "https://example.com/a.webp", ...BOUND_PICTURE_SIZE, alt: "" } })).toEqual({ width: 1600, height: 1200 });
    expect(BOUND_PICTURE_SIZE.width / BOUND_PICTURE_SIZE.height).toBeCloseTo(IMAGE_SHAPE_RATIO.landscape, 10);
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
        "A button's address must be https://…, a page like /about, an anchor like #contact, mailto: or tel:.",
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
    // Three on computers, two on tablets, one on phones (D179: Extra large, and the smaller sizes' overrides).
    expect(grid).toMatchObject({ type: "contentGrid", source: { type: "pages" }, limit: 6, columns: 3, at: { md: { columns: 2 }, sm: { columns: 1 } } });
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
    const { columns, ...rest } = grid;
    void columns;
    // Columns by screen as saved before D179 are read as computers' columns and the overrides of the sizes that differ.
    const parsed = pageInput.parse(page(grid)).rows[0].columns[0].blocks[0];
    expect(parsed).toMatchObject({ ...rest, columns: 6, at: { md: { columns: 3 }, sm: { columns: 2 } } });
    expect(pageInput.parse(page({ ...rest, columns: 5, at: { sm: { columns: 2 } } })).rows[0].columns[0].blocks[0]).toMatchObject({ columns: 5, at: { sm: { columns: 2 } } });
  });

  it("refuses an unknown source, too many items or columns, and a tile heading at H1", () => {
    expect(problems(page({ source: { type: "videos" } }))).toEqual(["A content grid shows an unknown kind of content."]);
    expect(problems(page({ source: { type: "products", storeId: "x", market: "NO" } }))).toEqual([
      "Choose the store whose products the grid shows.",
    ]);
    expect(problems(page({ limit: 49 }))).toEqual(["A grid shows at most 48 items."]);
    expect(problems(page({ limit: 0 }))).toEqual(["A grid shows at least one item."]);
    expect(problems(page({ columns: { mobile: 3, tablet: 2, desktop: 3 } }))).not.toEqual([]);
    expect(problems(page({ columns: { mobile: 1, tablet: 2, desktop: 9 } }))).not.toEqual([]);
    expect(problems(page({ columns: 9 }))).not.toEqual([]);
    expect(problems(page({ columns: 0 }))).not.toEqual([]);
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
    const routes = entries.filter((e) => e.isDirectory() && !/^[[(@]/.test(e.name)).map((e) => e.name);
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) expect(RESERVED_STORE_PAGE_SLUGS, route).toContain(route);
  });
});

describe("fonts per component (D59)", () => {
  const page = (blocks: unknown[]) => ({
    ...newPageContent(),
    title: "Fonts",
    slug: "fonts",
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] }],
  });

  it("keeps each text component's font and a button's weight, dropping empty ones", () => {
    const blocks = [
      { id: "t", type: "richText", doc: doc(p("Hi")), font: "Lora" },
      { id: "h", type: "heading", text: "Prices", level: 2, font: "Playfair Display" },
      { id: "b", type: "button", label: "Start", href: "/sign-up", font: "Inter", weight: "bold" },
      { id: "i", type: "image", image: null, caption: "", font: "" },
      { ...newBlock("contentGrid", () => "g"), font: "Inter", headingFont: "Lora" },
    ];
    const parsed = pageInput.parse(page(blocks));
    const [text, heading, button, image, grid] = parsed.rows[0].columns[0].blocks;
    expect(text).toMatchObject({ font: "Lora" });
    expect(heading).toMatchObject({ font: "Playfair Display" });
    expect(button).toMatchObject({ font: "Inter", weight: "bold" });
    expect(JSON.parse(JSON.stringify(image))).not.toHaveProperty("font");
    expect(grid).toMatchObject({ font: "Inter", headingFont: "Lora" });
    expect(parsed.rows[0].columns[0].blocks.flatMap(blockFonts)).toEqual(["Lora", "Playfair Display", "Inter", "Inter", "Lora"]);
    expect(pageFonts(parsed)).toEqual(["Lora", "Playfair Display", "Inter"]);
  });

  it("refuses what is not a family name", () => {
    const parsed = pageInput.safeParse(page([{ id: "t", type: "richText", doc: doc(p("Hi")), font: 'Lora"; } body { color: red' }]));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain("Choose a font from the list.");
  });
});
