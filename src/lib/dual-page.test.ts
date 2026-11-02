import { describe, expect, it } from "vitest";

import {
  closeHalf,
  copyAcross,
  draggedSplit,
  dropProblem,
  dualHref,
  findDualPart,
  followScroll,
  followScrollShare,
  formatDualWith,
  openIn,
  parseDualLayout,
  parseDualWith,
  shownAt,
  splitShare,
  templateAsPage,
  withCopiedTranslations,
  type DualLayout,
  type DualPart,
} from "./dual-page";
import { partFromRows } from "./saved-part-canvas";
import type { SavedPart } from "./saved-parts";
import type { PageBlock, PageRow } from "./page-content";
import { newBlock } from "./page-rows";

const ID = "3f2b6c1e-8d4a-4b7e-9c2d-1a2b3c4d5e6f";
const counter = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const heading = (id: string, text: string, extra: Partial<PageBlock> = {}): PageBlock => ({ id, type: "heading", text, level: 2, ...extra }) as PageBlock;
const row = (id: string, blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id, type: "row", layout: "1", columns: [{ id: `${id}-c`, blocks }], ...extra });

describe("the second document's address", () => {
  it("reads a page by kind and id, a new one of a kind, and a saved template", () => {
    expect(parseDualWith(`article:${ID}`)).toEqual({ kind: "article", id: ID });
    expect(parseDualWith("new:product_layout")).toEqual({ kind: "product_layout", id: null });
    expect(parseDualWith(`template:${ID.toUpperCase()}`)).toEqual({ kind: "template", id: ID });
    for (const doc of [{ kind: "article", id: ID }, { kind: "header", id: null }, { kind: "template", id: ID }] as const) {
      expect(parseDualWith(formatDualWith(doc))).toEqual(doc);
    }
  });

  it("reads nothing from anything else: an A/B test's version, a new entry page, an id that is not one, two values", () => {
    for (const bad of [`variant:${ID}`, "new:entry_layout", "new:template", "page:42", `page:${ID}:x`, "page", "", undefined]) {
      expect(parseDualWith(bad)).toBeNull();
    }
    expect(parseDualWith([`page:${ID}`, `article:${ID}`])).toBeNull();
  });
});

describe("what a dual page shows, as its address holds it (D424)", () => {
  const OTHER = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const T = "0f0e0d0c-0b0a-4908-8706-050403020100";
  const page = { kind: "page", id: ID } as const;
  const base = (kind: string) => `/admin/s/${kind === "article" ? "articles" : "pages"}`;
  const layout = (over: Partial<DualLayout> = {}): DualLayout => ({ first: page, firstOpen: true, second: { kind: "article", id: OTHER }, swap: false, ...over });

  it("reads the second half, a closed first half and a swap, and writes them back", () => {
    expect(parseDualLayout(page, { with: `article:${OTHER}` })).toEqual(layout());
    expect(parseDualLayout(page, { with: "empty", first: "empty", swap: "1" })).toEqual(layout({ second: "empty", firstOpen: false, swap: true }));
    expect(parseDualLayout(page, { with: "mirror" })).toEqual(layout({ second: "mirror" }));
    for (const each of [layout(), layout({ second: "empty", firstOpen: false, swap: true }), layout({ second: "mirror" }), layout({ second: { kind: "template", id: T } })]) {
      const href = new URL(dualHref(base, each), "https://x.test");
      expect(href.pathname).toBe(`/admin/s/pages/${ID}`);
      expect(parseDualLayout(page, Object.fromEntries(href.searchParams))).toEqual(each);
    }
    expect(dualHref(base, layout({ first: { kind: "article", id: null }, second: "empty" }))).toBe("/admin/s/articles/new?with=empty");
  });

  it("reads the first document named again as the same document twice, and asks for nothing without a second half", () => {
    expect(parseDualLayout(page, { with: `page:${ID}` })).toEqual(layout({ second: "mirror" }));
    // Twice with the first half closed is the document once.
    expect(parseDualLayout(page, { with: "mirror", first: "empty" })).toEqual(layout({ second: "empty" }));
    expect(parseDualLayout(page, {})).toBeNull();
    expect(parseDualLayout(page, { with: "nothing" })).toBeNull();
    // Two new pages are two pages.
    expect(parseDualLayout({ kind: "page", id: null }, { with: "new:page" })).toEqual(layout({ first: { kind: "page", id: null }, second: { kind: "page", id: null } }));
  });

  it("closes either half, and closes the same document twice into once, where the other canvas was", () => {
    expect(closeHalf(layout(), "right")).toEqual(layout({ second: "empty" }));
    expect(closeHalf(layout(), "left")).toEqual(layout({ firstOpen: false }));
    expect(closeHalf(closeHalf(layout(), "left"), "right")).toEqual(layout({ firstOpen: false, second: "empty" }));
    expect(closeHalf(layout({ second: "mirror" }), "right")).toEqual(layout({ second: "empty" }));
    // Its first canvas closed: it stays where its second canvas was drawn.
    const closed = closeHalf(layout({ second: "mirror" }), "left");
    expect(closed).toEqual(layout({ second: "empty", swap: true }));
    expect(shownAt("left", closed.swap)).toBe("right");
  });

  it("opens a document in an empty half, where it was asked for", () => {
    const article = { kind: "article", id: OTHER } as const;
    expect(openIn(layout({ second: "empty" }), "right", article)).toEqual(layout());
    expect(openIn(layout({ firstOpen: false }), "left", { kind: "header", id: null })).toEqual(layout({ first: { kind: "header", id: null } }));
    // A saved template is always the second half, drawn on the side asked for.
    const template = { kind: "template", id: T } as const;
    const left = openIn(layout({ firstOpen: false }), "left", template)!;
    expect(left).toEqual(layout({ first: article, second: template, swap: true }));
    expect(shownAt("right", left.swap)).toBe("left");
    const alone = openIn(layout({ firstOpen: false, second: "empty" }), "left", template)!;
    expect(alone).toEqual(layout({ firstOpen: false, second: template, swap: true }));
    expect(openIn(layout({ firstOpen: false, second: template }), "left", { kind: "template", id: OTHER })).toBeNull();
  });

  it("opens the other half's document again at another size, drawn in the half asked for", () => {
    expect(openIn(layout({ second: "empty" }), "right", "mirror")).toEqual(layout({ second: "mirror" }));
    expect(openIn(layout({ second: "empty" }), "right", page)).toEqual(layout({ second: "mirror" }));
    // From the first half: the second's document becomes the address's own, its second canvas drawn where it was asked for.
    const article = { kind: "article", id: OTHER } as const;
    const twice = openIn(layout({ firstOpen: false }), "left", "mirror")!;
    expect(twice).toEqual(layout({ first: article, second: "mirror", swap: true }));
    expect(shownAt("right", twice.swap)).toBe("left");
    expect(openIn(layout({ firstOpen: false }), "left", article)).toEqual(twice);
    // Nothing to draw twice.
    expect(openIn(layout({ firstOpen: false, second: "empty" }), "right", "mirror")).toBeNull();
    expect(openIn(layout({ firstOpen: false, second: "empty" }), "left", "mirror")).toBeNull();
    expect(openIn(layout({ firstOpen: false, second: { kind: "template", id: T } }), "left", "mirror")).toBeNull();
    // The closed first document asked for in the second half is it alone again, where it was asked for.
    expect(openIn(layout({ firstOpen: false, second: "empty" }), "right", page)).toEqual(layout({ second: "empty", swap: true }));
  });

  it("shares the width from a fifth to four fifths, dragged with the half on the left growing", () => {
    expect(splitShare(0.5)).toBe(0.5);
    expect(splitShare(0.05)).toBe(0.2);
    expect(splitShare(0.95)).toBe(0.8);
    expect(splitShare(Number.NaN)).toBe(0.5);
    expect(draggedSplit(0.5, 100, 1000, false)).toBe(0.6);
    // Swapped, the first document is on the right: dragging the edge right makes it narrower.
    expect(draggedSplit(0.5, 100, 1000, true)).toBe(0.4);
    expect(draggedSplit(0.5, 900, 1000, false)).toBe(0.8);
    expect(draggedSplit(0.6, 100, 0, false)).toBe(0.6);
  });

  it("scrolls one document drawn twice by how far through it is, not by pixels", () => {
    expect(followScrollShare({ scrollTop: 500, scrollHeight: 2000, clientHeight: 1000 }, { scrollHeight: 5000, clientHeight: 800 })).toBe(2100);
    expect(followScrollShare({ scrollTop: 0, scrollHeight: 900, clientHeight: 1000 }, { scrollHeight: 5000, clientHeight: 800 })).toBe(0);
    expect(followScrollShare({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 1000 }, { scrollHeight: 600, clientHeight: 800 })).toBe(0);
  });
});

describe("a drop on the other page", () => {
  const product: DualPart = { kind: "block", content: newBlock("product", counter("p"), "price") };
  const site: DualPart = { kind: "block", content: newBlock("site", counter("s"), "logo") };
  const text: DualPart = { kind: "row", content: row("r", [heading("h", "Hello")]) };

  it("is refused where the page could not be saved with it, as a save would say", () => {
    expect(dropProblem("store", "page", product)).toMatch(/Product components belong in product layouts/);
    expect(dropProblem("store", "product_layout", product)).toBeNull();
    expect(dropProblem("store", "article", site)).toMatch(/Site components belong in headers and footers/);
    expect(dropProblem("store", "header", site)).toBeNull();
    // A shop's part is a store page's alone.
    expect(dropProblem("store", "article", { kind: "block", content: newBlock("storePart", counter("x"), "cart") })).toMatch(/shop components/);
    expect(dropProblem(null, "page", { kind: "block", content: newBlock("storePart", counter("x"), "cart") })).toMatch(/shop components/);
  });

  it("lets plain parts go anywhere", () => {
    for (const kind of ["page", "article", "product_layout", "header", "footer", "entry_layout"] as const) {
      expect(dropProblem("store", kind, text)).toBeNull();
    }
  });
});

describe("the copy a drop across makes", () => {
  it("has new ids throughout and every setting, and leaves the original as it was", () => {
    const original = row("r1", [heading("h1", "Hello", { hideAt: ["sm"] } as Partial<PageBlock>)], { background: { color: "#ff0000" } } as Partial<PageRow>);
    const before = structuredClone(original);
    const { part } = copyAcross({ kind: "row", content: original }, { rows: [original] }, [], counter("n"));
    const copy = part.content as PageRow;
    expect(copy.id).not.toBe("r1");
    expect(copy.columns[0].id).not.toBe("r1-c");
    expect(copy.columns[0].blocks[0].id).not.toBe("h1");
    expect(copy.background).toEqual(original.background);
    expect((copy.columns[0].blocks[0] as { hideAt?: string[] }).hideAt).toEqual(["sm"]);
    expect(original).toEqual(before);
  });

  it("leaves out a custom id the target page uses already, and keeps one it does not", () => {
    const original = row("r1", [heading("h1", "A", { htmlId: "offer" } as Partial<PageBlock>), heading("h2", "B", { htmlId: "news" } as Partial<PageBlock>)]);
    const target = [row("t1", [heading("t", "T", { htmlId: "offer" } as Partial<PageBlock>)])];
    const { part } = copyAcross({ kind: "row", content: original }, { rows: [original] }, target, counter("n"));
    const blocks = (part.content as PageRow).columns[0].blocks as { htmlId?: string }[];
    expect(blocks[0].htmlId).toBeUndefined();
    expect(blocks[1].htmlId).toBe("news");
  });

  it("brings its texts' translations under the copy's ids, and only its own", () => {
    const a = heading("h1", "Hello");
    const other = heading("h9", "Elsewhere");
    const source = { rows: [row("r1", [a]), row("r9", [other])], translations: { nb: { "block.h1.text": "Hei", "block.h9.text": "Annet sted" } } };
    const { part, translations } = copyAcross({ kind: "block", content: a }, source, [], counter("n"));
    expect(translations).toEqual({ nb: { [`block.${part.content.id}.text`]: "Hei" } });
    // The page's own translations are kept beside the copy's.
    expect(withCopiedTranslations({ nb: { "block.x.text": "X" } }, translations)).toEqual({ nb: { "block.x.text": "X", [`block.${part.content.id}.text`]: "Hei" } });
    expect(withCopiedTranslations(undefined, {})).toBeUndefined();
  });

  it("finds rows, columns and components, nested ones too", () => {
    const rows = [row("r1", [heading("h1", "A")])];
    expect(findDualPart(rows, "row", "r1")?.content.id).toBe("r1");
    expect(findDualPart(rows, "column", "r1-c")?.content.id).toBe("r1-c");
    expect(findDualPart(rows, "block", "h1")?.content.id).toBe("h1");
    expect(findDualPart(rows, "block", "r1")).toBeNull();
    expect(findDualPart(rows, "column", "h1")).toBeNull();
  });
});

describe("scrolling together", () => {
  it("takes the other page as far down by pixels, never past its end or above its top", () => {
    expect(followScroll(300, { scrollHeight: 2000, clientHeight: 800 })).toBe(300);
    expect(followScroll(1500, { scrollHeight: 2000, clientHeight: 800 })).toBe(1200);
    expect(followScroll(100, { scrollHeight: 500, clientHeight: 800 })).toBe(0);
  });
});

describe("a saved template as one of the two (D412 step 5)", () => {
  const base = { id: ID, name: "Hero", updatedAt: "2026-11-01T00:00:00Z", global: false, uses: 0, sharing: "private" as const };

  it("is a row's rows under its name, edited as a page, with its translations, and saves back as the same row", () => {
    const part = { ...base, kind: "row", content: row("r1", [heading("h1", "Hello")]), translations: { nb: { "block.h1.text": "Hei" } } } as SavedPart;
    const { shape, page } = templateAsPage(part);
    expect(shape).toBe("page");
    expect(page.draft.title).toBe("Hero");
    expect(page.draft.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(page.draft.translations).toEqual({ nb: { "block.h1.text": "Hei" } });
    expect(partFromRows(part, page.draft.rows)).toEqual({ ok: true, content: part.content });
  });

  it("is a page layout's rows and CSS, edited as the kind of page it is for", () => {
    const part = { ...base, kind: "page", content: { pageType: "header", rows: [row("r1", [])], css: ".a{color:red}" }, translations: {} } as SavedPart;
    const { shape, page } = templateAsPage(part);
    expect(shape).toBe("header");
    expect(page.draft.css).toBe(".a{color:red}");
    expect(page.draft.translations).toBeUndefined();
  });

  it("is a component in a row of one column, which saves back only while it stays one component", () => {
    const block = heading("h1", "Hi");
    const part = { ...base, kind: "block", content: block, translations: {} } as SavedPart;
    const { page } = templateAsPage(part);
    expect(page.draft.rows[0].columns[0].blocks).toEqual([block]);
    expect(partFromRows(part, [...page.draft.rows, row("r2", [])])).toEqual({ ok: false, problem: "oneBlock" });
  });
});
