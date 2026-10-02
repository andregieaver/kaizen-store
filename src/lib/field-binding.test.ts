import { describe, expect, it } from "vitest";

import type { ShownField, ShownGroup } from "./custom-fields";
import { bindPage, bindable, canBind, hasBindings, textToDoc, withoutBindings } from "./field-binding";
import {
  BOUND_PICTURE_SIZE,
  blockHasContent,
  blockShowsUnbound,
  imageDisplaySize,
  newPageContent,
  pageInput,
  type ButtonBlock,
  type HeadingBlock,
  type ImageBlock,
  type PageBlock,
  type PageContent,
  type RichTextBlock,
} from "./page-content";
import { copyRow } from "./page-rows";
import { mapTexts } from "./page-translation";

/**
 * Blocks bound to custom fields (D118, phase 2): what each kind can take, what a missing or empty field does,
 * that the page's own content is the fallback only when asked for, and that nothing but public fields is used.
 */

const field = (over: Partial<ShownField> & Pick<ShownField, "id" | "type">): ShownField => ({
  name: over.id,
  label: over.id,
  value: "",
  text: "",
  ...over,
});
const text = (id: string, value: string): ShownField => field({ id, type: "text", value, text: value });
const group = (...fields: ShownField[]): ShownGroup => ({
  id: "g1",
  name: "Specs",
  slug: "specs",
  position: "normal" as never,
  fields,
});

const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich words" }] }] };
const F = {
  title: text("f_title00", "  Oak\n table  "),
  notes: field({ id: "f_notes00", type: "richText", value: doc as never, text: "Rich words" }),
  about: field({ id: "f_about00", type: "textarea", value: "One\ntwo\n\nThree", text: "One\ntwo\n\nThree" }),
  picture: field({
    id: "f_pict000",
    type: "image",
    value: { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "An oak table" },
  }),
  sheet: field({
    id: "f_sheet00",
    type: "file",
    links: [{ label: "sheet.pdf", href: "https://cdn.example.com/sheet.pdf", newTab: true }],
  }),
  more: field({
    id: "f_more000",
    type: "link",
    text: "Care guide",
    links: [{ label: "Care guide", href: "/s/shop/no/care" }],
  }),
  address: text("f_addr000", "https://example.com/not-a-link-field"),
  blank: text("f_blank00", "   "),
};
const groups = [group(...Object.values(F))];

const heading = (over: Partial<HeadingBlock> = {}): HeadingBlock => ({
  id: "h",
  type: "heading",
  text: "Own",
  level: 2,
  ...over,
});
const rich = (over: Partial<RichTextBlock> = {}): RichTextBlock => ({
  id: "r",
  type: "richText",
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Own words" }] }] },
  ...over,
});
const image = (over: Partial<ImageBlock> = {}): ImageBlock => ({
  id: "i",
  type: "image",
  image: null,
  caption: "Caption",
  ...over,
});
const button = (over: Partial<ButtonBlock> = {}): ButtonBlock => ({
  id: "b",
  type: "button",
  label: "",
  href: "",
  ...over,
});

const pageOf = (...blocks: PageBlock[]): PageContent => ({
  ...newPageContent(),
  rows: [{ id: "row1", type: "row", layout: "1", columns: [{ id: "col1", blocks }] }],
});
const blocksOf = (content: PageContent) =>
  content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

describe("which fields a block can take", () => {
  it("lists the field types of each kind", () => {
    expect(bindable("heading", "text")).toBe(true);
    expect(bindable("heading", "number")).toBe(true);
    expect(bindable("heading", "richText")).toBe(false);
    expect(bindable("richText", "richText")).toBe(true);
    expect(bindable("richText", "textarea")).toBe(true);
    expect(bindable("richText", "image")).toBe(false);
    expect(bindable("image", "image")).toBe(true);
    expect(bindable("image", "gallery")).toBe(false);
    expect(bindable("button", "file")).toBe(true);
    expect(bindable("button", "link")).toBe(true);
    // An address typed into a text field is not a link field.
    expect(bindable("button", "text")).toBe(false);
    expect(bindable("button", "url")).toBe(false);
    expect(bindable("separator", "text")).toBe(false);
    expect(bindable("nonsense", "text")).toBe(false);
  });

  it("knows which blocks can be bound at all", () => {
    expect(["heading", "richText", "image", "button"].every(canBind)).toBe(true);
    expect(canBind("video")).toBe(false);
  });
});

describe("hasBindings", () => {
  it("is true only when a block names a field", () => {
    expect(hasBindings(pageOf(heading(), rich()))).toBe(false);
    expect(hasBindings(pageOf(heading(), rich({ bind: { fieldId: "f_title00" } })))).toBe(true);
    expect(hasBindings(newPageContent())).toBe(false);
  });
});

describe("bindPage: what a bound block shows", () => {
  it("takes a heading's text from a text field, on one line", () => {
    const [block] = blocksOf(bindPage(pageOf(heading({ bind: { fieldId: "f_title00" } })), groups));
    expect(block).toMatchObject({ type: "heading", text: "Oak table" });
    expect(block).not.toHaveProperty("bind");
  });

  it("takes a rich text's document from a rich text field, and paragraphs from a text area", () => {
    const [fromRich] = blocksOf(bindPage(pageOf(rich({ bind: { fieldId: "f_notes00" } })), groups));
    expect(fromRich).toMatchObject({ type: "richText", doc });
    const [fromArea] = blocksOf(bindPage(pageOf(rich({ bind: { fieldId: "f_about00" } })), groups));
    expect((fromArea as RichTextBlock).doc.content).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "One" }, { type: "hardBreak" }, { type: "text", text: "two" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Three" }] },
    ]);
  });

  it("takes a picture from an image field, with its description", () => {
    const [block] = blocksOf(bindPage(pageOf(image({ bind: { fieldId: "f_pict000" } })), groups));
    expect((block as ImageBlock).image).toEqual({
      url: "https://cdn.example.com/a.webp",
      width: 1600,
      height: 1200,
      alt: "An oak table",
    });
    expect((block as ImageBlock).caption).toBe("Caption");
  });

  it("takes a button's address from a file or link field, its words only when it has none", () => {
    const [file] = blocksOf(bindPage(pageOf(button({ bind: { fieldId: "f_sheet00" } })), groups));
    expect(file).toMatchObject({ label: "sheet.pdf", href: "https://cdn.example.com/sheet.pdf", newTab: true });
    const [own] = blocksOf(bindPage(pageOf(button({ label: "Download", bind: { fieldId: "f_sheet00" } })), groups));
    expect(own).toMatchObject({ label: "Download", href: "https://cdn.example.com/sheet.pdf" });
    const [link] = blocksOf(
      bindPage(pageOf(button({ label: "Guide", newTab: true, bind: { fieldId: "f_more000" } })), groups),
    );
    expect(link).toMatchObject({ label: "Guide", href: "/s/shop/no/care" });
  });

  it("does not use a text field that holds an address for a button", () => {
    expect(blocksOf(bindPage(pageOf(button({ label: "Go", bind: { fieldId: "f_addr000" } })), groups))).toEqual([]);
  });

  it("never draws an unsafe address", () => {
    const unsafe = [
      group(field({ id: "f_bad0000", type: "link", links: [{ label: "x", href: "javascript:alert(1)" }] })),
    ];
    expect(blocksOf(bindPage(pageOf(button({ label: "Go", bind: { fieldId: "f_bad0000" } })), unsafe))).toEqual([]);
    const badPicture = [
      group(
        field({ id: "f_badpic0", type: "image", value: { url: "javascript:alert(1)", thumbnailUrl: null, alt: "" } }),
      ),
    ];
    expect(blocksOf(bindPage(pageOf(image({ bind: { fieldId: "f_badpic0" } })), badPicture))).toEqual([]);
  });

  it("checks a rich text field's document again", () => {
    const bad = [
      group(
        field({
          id: "f_badrich",
          type: "richText",
          value: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
                ],
              },
            ],
          } as never,
        }),
      ),
    ];
    expect(blocksOf(bindPage(pageOf(rich({ bind: { fieldId: "f_badrich" } })), bad))).toEqual([]);
  });
});

describe("bindPage: a field with nothing to give", () => {
  const cases: [string, PageBlock][] = [
    ["a heading", heading({ bind: { fieldId: "f_blank00" } })],
    ["a heading whose field is gone", heading({ bind: { fieldId: "f_gone000" } })],
    ["a rich text of the wrong kind", rich({ bind: { fieldId: "f_pict000" } })],
    ["an image of the wrong kind", image({ bind: { fieldId: "f_title00" } })],
    ["a button of the wrong kind", button({ label: "Go", href: "/x", bind: { fieldId: "f_notes00" } })],
  ];

  it.each(cases)("leaves out %s, keeping the row and column", (_name, block) => {
    const result = bindPage(pageOf(block, heading({ id: "other", text: "Stays" })), groups);
    expect(blocksOf(result).map((b) => b.id)).toEqual(["other"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].columns).toHaveLength(1);
  });

  it("keeps the block's own content when asked, without its binding", () => {
    const result = bindPage(pageOf(heading({ bind: { fieldId: "f_gone000", fallback: true } })), groups);
    const [block] = blocksOf(result);
    expect(block).toMatchObject({ type: "heading", text: "Own" });
    expect(block).not.toHaveProperty("bind");
  });

  it("draws nothing for a fallback block that has no content of its own", () => {
    const result = bindPage(pageOf(heading({ text: "", bind: { fieldId: "f_gone000", fallback: true } })), groups);
    expect(blocksOf(result).filter(blockShowsUnbound)).toEqual([]);
  });

  it("shows the field, not the fallback, when the field has a value", () => {
    const [block] = blocksOf(bindPage(pageOf(heading({ bind: { fieldId: "f_title00", fallback: true } })), groups));
    expect(block).toMatchObject({ text: "Oak table" });
  });

  it("has no fields to use with no groups: only fallback blocks with content stay", () => {
    const result = bindPage(
      pageOf(
        heading({ id: "a", bind: { fieldId: "f_title00" } }),
        heading({ id: "b", bind: { fieldId: "f_title00", fallback: true } }),
      ),
      [],
    );
    expect(blocksOf(result).map((b) => b.id)).toEqual(["b"]);
  });

  it("uses only the fields it is given: a private field is not among them", () => {
    const publicOnly = [group(F.title)];
    const result = bindPage(pageOf(rich({ bind: { fieldId: "f_notes00" } })), publicOnly);
    expect(blocksOf(result)).toEqual([]);
  });

  it("does not use a field inside a group or repeater", () => {
    const nested = [group(field({ id: "f_group00", type: "group", children: [text("f_inner00", "Inner")] }))];
    expect(blocksOf(bindPage(pageOf(heading({ bind: { fieldId: "f_inner00" } })), nested))).toEqual([]);
  });
});

describe("bindPage: shape", () => {
  it("returns a page with no bound block as it is", () => {
    const page = pageOf(heading(), rich());
    expect(bindPage(page, groups)).toBe(page);
  });

  it("does not change the page it is given", () => {
    const page = pageOf(heading({ bind: { fieldId: "f_title00" } }));
    const before = JSON.stringify(page);
    bindPage(page, groups);
    expect(JSON.stringify(page)).toBe(before);
  });

  it("binds blocks in every row and column", () => {
    const page: PageContent = {
      ...newPageContent(),
      rows: [
        {
          id: "r1",
          type: "row",
          layout: "2",
          columns: [
            { id: "c1", blocks: [heading({ id: "h1", bind: { fieldId: "f_title00" } })] },
            { id: "c2", blocks: [heading({ id: "h2", bind: { fieldId: "f_title00" } })] },
          ],
        },
        {
          id: "r2",
          type: "row",
          layout: "1",
          columns: [{ id: "c3", blocks: [heading({ id: "h3", bind: { fieldId: "f_title00" } })] }],
        },
      ],
    };
    expect(blocksOf(bindPage(page, groups)).map((b) => (b as HeadingBlock).text)).toEqual([
      "Oak table",
      "Oak table",
      "Oak table",
    ]);
  });

  it("does not throw on odd values", () => {
    const odd = [
      group(
        field({ id: "f_odd0000", type: "richText", value: null as never }),
        field({ id: "f_odd0001", type: "image", value: [] as never }),
      ),
    ];
    expect(() =>
      bindPage(
        pageOf(
          rich({ bind: { fieldId: "f_odd0000" } }),
          image({ bind: { fieldId: "f_odd0001" } }),
          button({ bind: { fieldId: "f_odd0001" } }),
        ),
        odd,
      ),
    ).not.toThrow();
  });

  it("gives a bound block's content to the site, which needs no binding", () => {
    expect(blockHasContent(heading({ text: "", bind: { fieldId: "f_title00" } }))).toBe(true);
    expect(blockHasContent(heading({ text: "" }))).toBe(false);
    // Where nothing fills it, a bound block shows only when it keeps its own content.
    expect(blockShowsUnbound(heading({ bind: { fieldId: "f_title00" } }))).toBe(false);
    expect(blockShowsUnbound(heading({ bind: { fieldId: "f_title00", fallback: true } }))).toBe(true);
    expect(blockShowsUnbound(heading({ text: "", bind: { fieldId: "f_title00", fallback: true } }))).toBe(false);
    expect(blockShowsUnbound(heading())).toBe(true);
  });

  it("takes the binding off for a preview", () => {
    const page = pageOf(heading({ bind: { fieldId: "f_title00" } }));
    const [block] = blocksOf(withoutBindings(page));
    expect(block).toMatchObject({ text: "Own" });
    expect(block).not.toHaveProperty("bind");
  });
});

describe("text as a rich text", () => {
  it("makes paragraphs and line breaks, never markup", () => {
    expect(textToDoc("<b>a</b>\n\nb").content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "<b>a</b>" }] },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ]);
    expect(textToDoc("  ")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("bindings in a page's life", () => {
  const row = (blocks: unknown[]) => ({ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] });
  const input = (blocks: unknown[]) => ({ ...newPageContent(), title: "T", slug: "t", rows: [row(blocks)] });

  it("survives saving, on each kind of block that can take a field", () => {
    const parsed = pageInput.parse(
      input([
        { id: "b1", type: "heading", text: "", level: 2, bind: { fieldId: "f_title00", fallback: true } },
        {
          id: "b2",
          type: "richText",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          bind: { fieldId: "f_notes00" },
        },
        { id: "b3", type: "image", image: null, bind: { fieldId: "f_pict000" } },
        { id: "b4", type: "button", label: "", href: "", bind: { fieldId: "f_sheet00" } },
      ]),
    );
    expect(blocksOf(parsed as PageContent).map((b) => (b as HeadingBlock).bind)).toEqual([
      { fieldId: "f_title00", fallback: true },
      { fieldId: "f_notes00" },
      { fieldId: "f_pict000" },
      { fieldId: "f_sheet00" },
    ]);
  });

  it("refuses a binding to something that is not a field's id", () => {
    for (const bind of [{ fieldId: "title" }, { fieldId: "" }, { fieldId: "f_A" }, { fallback: true }, "f_title00"]) {
      expect(
        pageInput.safeParse(input([{ id: "b1", type: "heading", text: "x", level: 2, bind }])).success,
        JSON.stringify(bind),
      ).toBe(false);
    }
  });

  it("is not kept on a block that cannot take a field", () => {
    const parsed = pageInput.parse(input([{ id: "b1", type: "separator", bind: { fieldId: "f_title00" } }]));
    expect(blocksOf(parsed as PageContent)[0]).not.toHaveProperty("bind");
  });

  it("is copied with a row", () => {
    const original = pageOf(heading({ bind: { fieldId: "f_title00", fallback: true } })).rows[0];
    let n = 0;
    const copy = copyRow(original, () => `n${++n}`);
    expect(copy.columns[0].blocks[0]).toMatchObject({ bind: { fieldId: "f_title00", fallback: true } });
    expect(copy.columns[0].blocks[0].id).not.toBe("h");
  });

  it("keeps the block's own text translatable, and the binding through translating", () => {
    const page = pageOf(heading({ bind: { fieldId: "f_title00" } }));
    const keys: string[] = [];
    const mapped = mapTexts(page, (key, value) => {
      keys.push(key);
      return value;
    });
    expect(keys).toContain("block.h.text");
    expect(blocksOf(mapped)[0]).toMatchObject({ bind: { fieldId: "f_title00" } });
  });
});

describe("a bound picture's own size (D151)", () => {
  const align = { mobile: "center", desktop: "right" } as const;
  const own = { url: "https://cdn.example.com/own.webp", width: 640, height: 480, alt: "Own" };
  const sized = (over: Partial<ImageBlock> = {}) => image({ maxWidth: 300, align: { ...align }, bind: { fieldId: "f_pict000" }, ...over });

  it("is drawn at the stand-in's size, which the editor shares, since the field's real size is not known here", () => {
    expect(BOUND_PICTURE_SIZE).toEqual({ width: 1600, height: 1200 });
    const [plain] = blocksOf(bindPage(pageOf(image({ bind: { fieldId: "f_pict000" } })), groups)) as ImageBlock[];
    expect(plain.image).toEqual({ url: "https://cdn.example.com/a.webp", ...BOUND_PICTURE_SIZE, alt: "An oak table" });
    expect(imageDisplaySize(plain)).toEqual({ width: 1600, height: 1200 });
  });

  it("keeps the width and position the owner gave the block, and draws the field's picture no wider than that", () => {
    const [block] = blocksOf(bindPage(pageOf(sized()), groups)) as ImageBlock[];
    expect(block).toMatchObject({
      maxWidth: 300,
      align: { mobile: "center", desktop: "right" },
      caption: "Caption",
      image: { url: "https://cdn.example.com/a.webp", width: 1600, height: 1200, alt: "An oak table" },
    });
    expect(block).not.toHaveProperty("bind");
    expect(imageDisplaySize(block)).toEqual({ width: 300, height: 225 });
    // A crop of the bound picture is sized from the stand-in too.
    const [crop] = blocksOf(bindPage(pageOf(sized({ shape: "circle", maxWidth: undefined })), groups)) as ImageBlock[];
    expect(imageDisplaySize(crop)).toEqual({ width: 1200, height: 1200 });
  });

  it("keeps them on the block's own picture when the field gives nothing and the block asks for its own content", () => {
    const result = bindPage(pageOf(sized({ image: own, bind: { fieldId: "f_gone000", fallback: true } })), groups);
    const [block] = blocksOf(result) as ImageBlock[];
    expect(block).toMatchObject({ image: own, maxWidth: 300, align: { mobile: "center", desktop: "right" } });
    expect(block).not.toHaveProperty("bind");
    expect(imageDisplaySize(block)).toEqual({ width: 300, height: 225 });
  });

  it("keeps them when the bindings are taken off for the builder's canvas", () => {
    const [block] = blocksOf(withoutBindings(pageOf(sized()))) as ImageBlock[];
    expect(block).toMatchObject({ image: null, maxWidth: 300, align: { mobile: "center", desktop: "right" } });
    expect(block).not.toHaveProperty("bind");
  });

  it("is left out with the block when the field gives nothing, as any bound block is", () => {
    expect(blocksOf(bindPage(pageOf(sized({ bind: { fieldId: "f_gone000" } })), groups))).toEqual([]);
  });

  it("survives saving a page with a bound picture, and is copied with its row", () => {
    const saved = pageInput.parse({
      ...newPageContent(),
      title: "T",
      slug: "t",
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [sized({ id: "i1" })] }] }],
    }) as PageContent;
    expect(blocksOf(saved)[0]).toMatchObject({ bind: { fieldId: "f_pict000" }, maxWidth: 300, align: { mobile: "center", desktop: "right" } });
    let n = 0;
    const copy = copyRow(saved.rows[0], () => `n${++n}`);
    expect(copy.columns[0].blocks[0]).toMatchObject({ bind: { fieldId: "f_pict000" }, maxWidth: 300, align: { mobile: "center", desktop: "right" } });
    expect(copy.columns[0].blocks[0].id).not.toBe("i1");
  });
});
