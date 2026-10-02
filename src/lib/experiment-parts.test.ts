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
    // A header's site components and a product layout's product components can be tested in their own kind of page only.
    const chrome = newRow("1", id);
    const site = insertBlock(insertRow([], chrome, 0), chrome.columns[0].id, newBlock("site", id, "logo"), 0);
    expect(testablePart({ rows: site }, { kind: "row", id: chrome.id })).toBe(false);
    expect(testablePart({ rows: site }, { kind: "row", id: chrome.id }, "header")).toBe(true);
    expect(testablePart({ rows: site }, { kind: "row", id: chrome.id }, "footer")).toBe(true);
    expect(testablePart({ rows: site }, { kind: "row", id: chrome.id }, "layout")).toBe(false);
    const buy = newRow("1", id);
    const product = insertBlock(insertRow([], buy, 0), buy.columns[0].id, newBlock("product", id, "title"), 0);
    expect(testablePart({ rows: product }, { kind: "row", id: buy.id })).toBe(false);
    expect(testablePart({ rows: product }, { kind: "row", id: buy.id }, "layout")).toBe(true);
    expect(testablePart({ rows: product }, { kind: "row", id: buy.id }, "header")).toBe(false);
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

/** A page with a modal row (D121) among two ordinary ones: opened by a timer unless `triggers` says otherwise. */
function pageWithModal(triggers: NonNullable<PageRow["modal"]>["triggers"] = { timer: { seconds: 5 } }) {
  const p = page();
  const popup = newRow("1", id);
  popup.modal = { key: "newsletter", name: "Newsletter", triggers, frequency: "session", size: "md" };
  const text = heading("Join our list");
  const rows = insertBlock(insertRow(p.content.rows, popup, 1), popup.columns[0].id, text, 0);
  return { ...p, content: { ...p.content, rows }, popup: rows[1], text };
}

describe("tests of a modal (D148, phase 9)", () => {
  const target = (row: PageRow) => ({ kind: "row" as const, id: row.id });

  it("offers a modal's row, names it by its name, and says whether it opens by itself", () => {
    const p = pageWithModal();
    expect(testablePart(p.content, target(p.popup))).toBe(true);
    expect(describePart(p.content, target(p.popup))).toMatchObject({ label: "Modal “Newsletter” (row 2)", modal: { byItself: true } });
    const linked = pageWithModal({ button: true });
    expect(describePart(linked.content, target(linked.popup))?.modal).toEqual({ byItself: false });
    expect(describePart(p.content, target(p.hero))?.modal).toBeNull();
  });

  it("lets a version change what the modal says and how it opens, and nothing else", () => {
    const p = pageWithModal();
    const reworded = edit(p.content, p.text.id, (b) => ({ ...b, text: "Get 10 % off" }) as PageBlock);
    expect(partChanges(p.content, reworded, target(p.popup))).toBe("ok");
    const slower = { ...p.content, rows: p.content.rows.map((r) => (r.id === p.popup.id ? { ...r, modal: { ...r.modal!, triggers: { timer: { seconds: 20 } } } } : r)) };
    expect(partChanges(p.content, slower, target(p.popup))).toBe("ok");
    expect(partChanges(p.content, edit(reworded, p.h2.id, (b) => ({ ...b, text: "Changed" }) as PageBlock), target(p.popup))).toBe("outside");
  });

  it("keeps a modal's address name and its being a modal, whatever it opens by, so links to it keep working", () => {
    const p = pageWithModal({ button: true });
    const renamed = { ...p.content, rows: p.content.rows.map((r) => (r.id === p.popup.id ? { ...r, modal: { ...r.modal!, key: "signup" } } : r)) };
    expect(partChanges(p.content, renamed, target(p.popup))).toBe("modal");
    const inline = { ...p.content, rows: p.content.rows.map((r) => (r.id === p.popup.id ? { ...r, modal: undefined } : r)) };
    expect(partChanges(p.content, inline, target(p.popup))).toBe("modal");
    // And an ordinary row cannot become one in a version.
    const hero = p.content.rows[0];
    const made = { ...p.content, rows: p.content.rows.map((r) => (r.id === hero.id ? { ...r, modal: { key: "x", triggers: { button: true }, frequency: "always" as const, size: "md" as const } } : r)) };
    expect(partChanges(p.content, made, target(hero))).toBe("modal");
  });

  it("lets a version leave out a modal that opens by itself, which is the test of whether it helps", () => {
    for (const triggers of [{ timer: { seconds: 5 } }, { exitIntent: true }, { timer: { seconds: 5 }, exitIntent: true }]) {
      const p = pageWithModal(triggers);
      const without = { ...p.content, rows: p.content.rows.filter((r) => r.id !== p.popup.id) };
      expect(partChanges(p.content, without, target(p.popup)), JSON.stringify(triggers)).toBe("ok");
      // Leaving out something else with it is not the same test.
      expect(partChanges(p.content, { ...without, rows: without.rows.filter((r) => r.id !== p.second.id) }, target(p.popup))).toBe("outside");
    }
  });

  it("does not let a version leave out a modal that a link or a class opens, or any other row", () => {
    for (const triggers of [{ button: true }, { className: "open-news" }, { button: true, timer: { seconds: 5 } }]) {
      const p = pageWithModal(triggers);
      const without = { ...p.content, rows: p.content.rows.filter((r) => r.id !== p.popup.id) };
      expect(partChanges(p.content, without, target(p.popup)), JSON.stringify(triggers)).toBe("missing");
    }
    const p = pageWithModal();
    expect(partChanges(p.content, { ...p.content, rows: p.content.rows.filter((r) => r.id !== p.second.id) }, target(p.second))).toBe("missing");
  });

  it("counts the other languages' texts of the left-out modal as its own, and of anything else as outside", () => {
    const p = pageWithModal();
    const content = { ...p.content, translations: { nb: { [`block.${p.text.id}.text`]: "Bli med", [`block.${p.h2.id}.text`]: "Vår historie" } } };
    const without = { ...content, rows: content.rows.filter((r) => r.id !== p.popup.id), translations: { nb: { [`block.${p.h2.id}.text`]: "Vår historie" } } };
    expect(partChanges(content, without, target(p.popup))).toBe("ok");
    expect(partChanges(content, { ...without, translations: { nb: {} } }, target(p.popup))).toBe("outside");
  });

  it("applies a winner that leaves the modal out by taking it, and its texts, out of the page as it is now", () => {
    const p = pageWithModal();
    const content = { ...p.content, translations: { nb: { [`block.${p.text.id}.text`]: "Bli med", [`block.${p.h2.id}.text`]: "Vår historie" } } };
    const without = { ...content, rows: content.rows.filter((r) => r.id !== p.popup.id) };
    // The page changed elsewhere while the test ran.
    const now = edit(content, p.h2.id, (b) => ({ ...b, text: "Our new story" }) as PageBlock);
    const applied = applyPart(now, without, target(p.popup))!;
    expect(applied.rows.map((r) => r.id)).toEqual([p.hero.id, p.second.id]);
    expect(JSON.stringify(applied.rows)).toContain("Our new story");
    expect(applied.translations).toEqual({ nb: { [`block.${p.h2.id}.text`]: "Vår historie" } });
    // A modal that a link opens is never taken out this way.
    const linked = pageWithModal({ button: true });
    expect(applyPart(linked.content, { ...linked.content, rows: linked.content.rows.filter((r) => r.id !== linked.popup.id) }, target(linked.popup))).toBeNull();
  });
});
