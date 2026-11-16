import { describe, expect, it } from "vitest";

import { ANCHOR, anchorOf, cellOf, isCandidateTarget, isRageable, partIdOf, PART_ID, type ChainLink } from "./heat-anchor";
import { DEFAULT_PRODUCT_LAYOUT } from "./product-layout";
import { defaultFooter, defaultHeader } from "./site-layout";

const ID = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
const link = (over: Partial<ChainLink>): ChainLink => ({ firstClass: null, tag: "div", ...over });

/** Every id in a page content's rows, columns and blocks, however deep. */
function ids(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) ids(v, out);
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && (o.type === "row" || "blocks" in o || "type" in o)) out.push(o.id);
    for (const v of Object.values(o)) ids(v, out);
  }
  return out;
}

describe("anchors (D656)", () => {
  it("takes the nearest part, never a class that only looks like one", () => {
    expect(partIdOf(`kz-${ID}`)).toBe(ID);
    expect(partIdOf("kz-page")).toBeNull();
    expect(partIdOf("kz-menu")).toBeNull();
    expect(partIdOf("kz-header-menu-button")).toBe("header-menu-button");
    expect(anchorOf([link({ tag: "img" }), link({ firstClass: "kz-page" }), link({ firstClass: `kz-${ID}` }), link({ tag: "main" })])).toEqual({ anchor: ID, at: 2 });
  });

  it("keeps a card inside a part apart from its neighbours, and a card in no part by its list", () => {
    expect(anchorOf([link({ tag: "img" }), link({ tag: "li", isProductCard: true, cardIndexInPart: 3 }), link({ firstClass: `kz-${ID}` })])).toEqual({ anchor: `${ID}/c3`, at: 1 });
    expect(anchorOf([link({ tag: "li", isProductCard: true, listIndex: 0, cardIndexInList: 2 }), link({ tag: "main" })])).toEqual({ anchor: "@card:0:2", at: 0 });
    expect(anchorOf([link({ tag: "li", isProductCard: true, listIndex: 1, cardIndexInList: 2 }), link({ tag: "main" })])).toEqual({ anchor: "@card:1:2", at: 0 });
  });

  it("falls back to the landmarks, then the page", () => {
    expect(anchorOf([link({ tag: "a" }), link({ tag: "nav" }), link({ tag: "header" })])).toEqual({ anchor: "@header", at: 2 });
    expect(anchorOf([link({ tag: "button" }), link({ tag: "body" })])).toEqual({ anchor: "@body", at: 1 });
    expect(anchorOf([])).toBeNull();
  });

  it("matches every fixed id of the default header, footer and product layout, and the server's anchor rule", () => {
    const fixed = [...ids(defaultHeader(null)), ...ids(defaultFooter(null)), ...ids(DEFAULT_PRODUCT_LAYOUT)];
    expect(fixed).toEqual(expect.arrayContaining(["header-row", "header-menu-button", "header-sign-up", "product-media"]));
    for (const id of fixed) expect(PART_ID.test(id), id).toBe(true);
    for (const anchor of [ID, `${ID}/c12`, "header-menu-button", "@card:3:41", "@main"]) expect(ANCHOR.test(anchor), anchor).toBe(true);
    for (const anchor of ["kz-page", "page", "@card:12:1", `${ID}/c123`, "@nav"]) expect(ANCHOR.test(anchor), anchor).toBe(false);
  });

  it("puts a click in a 10 × 10 grid of its box", () => {
    expect(cellOf(150, 120, { left: 100, top: 100, width: 100, height: 40 })).toEqual([5, 5]);
    expect(cellOf(99, 500, { left: 100, top: 100, width: 100, height: 40 })).toEqual([0, 9]);
    expect(cellOf(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual([0, 0]);
  });

  it("knows which clicks may be dead and which may rage", () => {
    expect(isCandidateTarget("IMG", false)).toBe(true);
    expect(isCandidateTarget("input", false)).toBe(false);
    expect(isCandidateTarget("label", false)).toBe(false);
    expect(isCandidateTarget("div", true)).toBe(false);
    expect(isRageable("button", null, false)).toBe(true);
    expect(isRageable("input", "text", false)).toBe(false);
    expect(isRageable("input", "checkbox", false)).toBe(true);
    expect(isRageable("textarea", null, false)).toBe(false);
  });
});

describe("the part class comes first on every part's wrapper (D656 relies on it)", () => {
  it("is the first class of a row, a column and a block on the live site", async () => {
    const { rowBox, columnBox, blockBox } = await import("@/components/page-parts");
    const row = DEFAULT_PRODUCT_LAYOUT.rows[0];
    const column = row.columns[0];
    const block = column.blocks[0];
    expect(rowBox(row, "site").className?.split(" ")[0]).toBe(`kz-${row.id}`);
    expect(columnBox(column, row, "site").className?.split(" ")[0]).toBe(`kz-${column.id}`);
    expect(blockBox(block, "site").className?.split(" ")[0]).toBe(`kz-${block.id}`);
  });
});
