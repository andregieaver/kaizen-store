import { describe, expect, it } from "vitest";

import { applyPart, buttonsWithin, describePart, findPart, partChanges, replacePart, testablePart, type PartNode } from "./experiment-parts";
import { newPageContent, type ButtonBlock, type HeadingBlock, type PageBlock, type PageContent, type PageRow } from "./page-content";
import { insertBlock, insertRow, newBlock, newRow } from "./page-rows";

let n = 0;
const id = () => `p${(n += 1)}`;

const heading = (text: string): HeadingBlock => ({ ...(newBlock("heading", id) as HeadingBlock), text });
const button = (label: string): ButtonBlock => ({ ...(newBlock("button", id) as ButtonBlock), label });

/** A page of two rows: a hero with a heading and a button, and a row with a heading. */
function page(): { content: PageContent; hero: PageRow; second: PageRow; h1: HeadingBlock; b1: ButtonBlock; h2: HeadingBlock } {
  const hero = newRow("1", id);
  const second = newRow("1", id);
  const h1 = heading("Welcome to the shop");
  const b1 = button("Buy now");
  const h2 = heading("Our story");
  let rows = insertRow(insertRow([], hero, 0), second, 1);
  rows = insertBlock(rows, hero.columns[0].id, h1, 0);
  rows = insertBlock(rows, hero.columns[0].id, b1, 1);
  rows = insertBlock(rows, second.columns[0].id, h2, 0);
  return { content: { ...newPageContent(), title: "Home", slug: "home", rows }, hero: rows[0], second: rows[1], h1, b1, h2 };
}

const edit = (content: PageContent, blockId: string, change: (b: PageBlock) => PageBlock): PageContent => ({
  ...content,
  rows: content.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === blockId ? change(b) : b)) })) })),
});

describe("finding and naming a part", () => {
  it("finds rows, columns and blocks by their id, with their kind", () => {
    const p = page();
    expect(findPart(p.content.rows, p.hero.id)?.kind).toBe("row");
    expect(findPart(p.content.rows, p.hero.columns[0].id)?.kind).toBe("column");
    expect(findPart(p.content.rows, p.h1.id)?.kind).toBe("block");
    expect(findPart(p.content.rows, "nope")).toBeNull();
  });

  it("calls a part by what the owner sees, and lists the buttons inside it", () => {
    const p = page();
    expect(describePart(p.content, { kind: "row", id: p.second.id })?.label).toBe("Row 2");
    expect(describePart(p.content, { kind: "column", id: p.hero.columns[0].id })?.label).toBe("Column 1 of row 1");
    expect(describePart(p.content, { kind: "block", id: p.h1.id })?.label).toBe("Heading “Welcome to the shop” in row 1");
    expect(describePart(p.content, { kind: "row", id: p.hero.id })?.buttons).toEqual([{ id: p.b1.id, label: "Buy now" }]);
    expect(describePart(p.content, { kind: "row", id: p.second.id })?.buttons).toEqual([]);
    // The kind has to match what the id is.
    expect(describePart(p.content, { kind: "block", id: p.hero.id })).toBeNull();
    const node = findPart(p.content.rows, p.hero.id)!;
    expect(buttonsWithin(node.kind, node.node)).toHaveLength(1);
  });

  it("only offers parts with something to see that are not the shop's working components", () => {
    const p = page();
    expect(testablePart(p.content, { kind: "block", id: p.h1.id })).toBe(true);
    expect(testablePart(p.content, { kind: "row", id: p.hero.id })).toBe(true);
    const shop = newRow("1", id);
    const rows = insertBlock(insertRow(p.content.rows, shop, 2), shop.columns[0].id, newBlock("storePart", id), 0);
    expect(testablePart({ rows }, { kind: "row", id: shop.id })).toBe(false);
    expect(testablePart({ rows: insertRow([], newRow("1", id), 0) }, { kind: "row", id: "x" })).toBe(false);
    const empty = newRow("1", id);
    expect(testablePart({ rows: [empty] }, { kind: "row", id: empty.id })).toBe(false);
  });
});

describe("a version that differs in the part only", () => {
  it("is fine when only the part changed, and wrong when something else did or the part is gone", () => {
    const p = page();
    const version = edit(p.content, p.h1.id, (b) => ({ ...(b as HeadingBlock), text: "Shorter" }));
    expect(partChanges(p.content, version, { kind: "block", id: p.h1.id })).toBe("ok");
    // The same change is outside a test of another part.
    expect(partChanges(p.content, version, { kind: "block", id: p.h2.id })).toBe("outside");
    // A change inside the row is inside a test of the row, outside a test of the other row.
    expect(partChanges(p.content, version, { kind: "row", id: p.hero.id })).toBe("ok");
    expect(partChanges(p.content, version, { kind: "row", id: p.second.id })).toBe("outside");
    // The page's own title and address differ by design.
    expect(partChanges(p.content, { ...version, title: "Home (B)", slug: "ab-1234-b" }, { kind: "block", id: p.h1.id })).toBe("ok");
    // A part taken away, or added elsewhere.
    expect(partChanges(p.content, { ...p.content, rows: [p.content.rows[1]] }, { kind: "row", id: p.hero.id })).toBe("missing");
    expect(partChanges(p.content, { ...p.content, rows: [...p.content.rows, newRow("1", id)] }, { kind: "row", id: p.hero.id })).toBe("outside");
    // An unchanged copy is `ok`: whether it differs at all is another check.
    expect(partChanges(p.content, p.content, { kind: "row", id: p.hero.id })).toBe("ok");
  });

  it("does not mind the order keys were written in", () => {
    const p = page();
    const shuffled = JSON.parse(JSON.stringify(p.content), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)) as PageContent;
    expect(partChanges(p.content, shuffled, { kind: "row", id: p.hero.id })).toBe("ok");
  });

  it("counts the other languages' texts of other parts as outside, and the part's own as inside", () => {
    const p = page();
    const original = { ...p.content, translations: { sv: { [`block.${p.h1.id}.text`]: "Välkommen", [`block.${p.h2.id}.text`]: "Vår historia" } } };
    const mine = { ...original, translations: { sv: { ...original.translations.sv, [`block.${p.h1.id}.text`]: "Hej" } } };
    expect(partChanges(original, mine, { kind: "block", id: p.h1.id })).toBe("ok");
    const theirs = { ...original, translations: { sv: { ...original.translations.sv, [`block.${p.h2.id}.text`]: "Historia" } } };
    expect(partChanges(original, theirs, { kind: "block", id: p.h1.id })).toBe("outside");
  });
});

describe("replacing and applying a part", () => {
  it("replaces a part of the same kind and id, and nothing else", () => {
    const p = page();
    const changed = { ...p.h1, text: "New" };
    const rows = replacePart(p.content.rows, { kind: "block", id: p.h1.id }, changed as PartNode)!;
    expect(findPart(rows, p.h1.id)?.node).toEqual(changed);
    expect(findPart(rows, p.h2.id)?.node).toEqual(p.h2);
    expect(replacePart(p.content.rows, { kind: "row", id: p.h1.id }, changed as PartNode)).toBeNull();
    expect(replacePart(p.content.rows, { kind: "block", id: p.h1.id }, { ...changed, id: "other" } as PartNode)).toBeNull();
  });

  it("puts the version's part into the page as it is now, so edits made after the test are kept", () => {
    const p = page();
    const version = edit(p.content, p.h1.id, (b) => ({ ...(b as HeadingBlock), text: "The winner" }));
    // The page changed elsewhere after the test: the second heading.
    const now = edit(p.content, p.h2.id, (b) => ({ ...(b as HeadingBlock), text: "Our new story" }));
    const applied = applyPart(now, version, { kind: "block", id: p.h1.id })!;
    expect((findPart(applied.rows, p.h1.id)!.node as HeadingBlock).text).toBe("The winner");
    expect((findPart(applied.rows, p.h2.id)!.node as HeadingBlock).text).toBe("Our new story");
    expect(applied.title).toBe("Home");
    expect(applied.slug).toBe("home");
  });

  it("takes the part's texts in other languages from the version and keeps the rest", () => {
    const p = page();
    const now = { ...p.content, translations: { sv: { [`block.${p.h1.id}.text`]: "Gammal", [`block.${p.h2.id}.text`]: "Vår historia" } } };
    const version = { ...edit(now, p.h1.id, (b) => ({ ...(b as HeadingBlock), text: "Winner" })), translations: { sv: { [`block.${p.h1.id}.text`]: "Vinnaren", [`block.${p.h2.id}.text`]: "Annat" } } };
    const applied = applyPart(now, version, { kind: "block", id: p.h1.id })!;
    expect(applied.translations?.sv).toEqual({ [`block.${p.h1.id}.text`]: "Vinnaren", [`block.${p.h2.id}.text`]: "Vår historia" });
  });

  it("refuses when the page has lost the part since", () => {
    const p = page();
    const version = edit(p.content, p.h1.id, (b) => ({ ...(b as HeadingBlock), text: "x" }));
    expect(applyPart({ ...p.content, rows: [p.content.rows[1]] }, version, { kind: "row", id: p.hero.id })).toBeNull();
  });
});
