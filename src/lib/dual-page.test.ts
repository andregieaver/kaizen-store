import { describe, expect, it } from "vitest";

import { copyAcross, dropProblem, findDualPart, followScroll, formatDualWith, parseDualWith, withCopiedTranslations, type DualPart } from "./dual-page";
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
