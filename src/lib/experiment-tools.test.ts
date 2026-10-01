import { describe, expect, it } from "vitest";

import { applyChanges, offeredBlocks, partOf } from "./experiment-tools";
import { newPageContent, type PageContent } from "./page-content";
import { insertBlock, insertRow, newBlock, newRow } from "./page-rows";

let n = 0;
const id = () => `t${(n += 1)}`;

function page() {
  const row = newRow("1", id);
  const heading = { ...newBlock("heading", id), text: "Welcome" } as never as { id: string };
  const button = { ...newBlock("button", id), label: "Buy now" } as never as { id: string };
  const text = newBlock("richText", id);
  const separator = newBlock("separator", id);
  let rows = insertRow([], row, 0);
  for (const [i, b] of [heading, button, text, separator].entries()) rows = insertBlock(rows, row.columns[0].id, b as never, i);
  const content: PageContent = { ...newPageContent(), title: "Home", slug: "home", rows };
  return { content, heading: heading.id, button: button.id, text: (text as { id: string }).id, separator: (separator as { id: string }).id };
}

describe("what the assistant may be offered to change", () => {
  it("lists headings, buttons and texts in order with what they say, and nothing else", () => {
    const p = page();
    expect(offeredBlocks(p.content).map((b) => [b.kind, b.text])).toEqual([
      ["heading", "Welcome"],
      ["button", "Buy now"],
      ["richText", ""],
    ]);
    expect(offeredBlocks(p.content, 2)).toHaveLength(2);
  });
});

describe("putting the assistant's words into a version", () => {
  it("changes a heading, a button and a text, and leaves everything else as it was", () => {
    const p = page();
    const done = applyChanges(p.content, [
      { block: p.heading, text: "Welcome to a calmer home" },
      { block: p.button, text: "See the lamps" },
      { block: p.text, text: "First paragraph.\n\nSecond paragraph." },
    ]);
    if (!done.ok) throw new Error(done.problem);
    expect(done.texts).toEqual(["Welcome to a calmer home", "See the lamps", "First paragraph.\n\nSecond paragraph."]);
    const blocks = done.content.rows[0].columns[0].blocks as unknown as Record<string, unknown>[];
    expect(blocks[0].text).toBe("Welcome to a calmer home");
    expect(blocks[1].label).toBe("See the lamps");
    expect(JSON.stringify(blocks[2].doc)).toContain("Second paragraph.");
    expect(blocks[3]).toEqual(p.content.rows[0].columns[0].blocks[3]);
    // The original is not touched.
    expect((p.content.rows[0].columns[0].blocks[0] as unknown as { text: string }).text).toBe("Welcome");
    expect(done.content.title).toBe("Home");
  });

  it("never turns words into markup", () => {
    const p = page();
    const done = applyChanges(p.content, [{ block: p.text, text: "<b>bold</b> <script>x</script>" }]);
    if (!done.ok) throw new Error(done.problem);
    // Markup typed as words stays words: the text is a plain text node, which the site draws as text.
    const doc = (done.content.rows[0].columns[0].blocks[2] as unknown as { doc: { content: { type: string; content: { type: string; text?: string }[] }[] } }).doc;
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph"]);
    expect(doc.content[0].content).toEqual([{ type: "text", text: "<b>bold</b> <script>x</script>" }]);
  });

  it("refuses what it cannot do, in words", () => {
    const p = page();
    expect(applyChanges(p.content, [{ block: "nope", text: "x" }])).toMatchObject({ ok: false, problem: expect.stringContaining("no block nope") });
    expect(applyChanges(p.content, [{ block: p.separator, text: "x" }])).toMatchObject({ ok: false, problem: expect.stringContaining("only headings, buttons and texts") });
    expect(applyChanges(p.content, [{ block: p.heading, text: "a" }, { block: p.heading, text: "b" }])).toMatchObject({ ok: false, problem: expect.stringContaining("twice") });
    expect(applyChanges(p.content, [{ block: p.heading, text: "x".repeat(301) }])).toMatchObject({ ok: false });
    expect(applyChanges(p.content, [{ block: p.heading, text: "two\nlines" }])).toMatchObject({ ok: false });
    expect(applyChanges(p.content, [{ block: p.button, text: "x".repeat(101) }])).toMatchObject({ ok: false });
    expect(applyChanges(p.content, [{ block: p.text, text: "x".repeat(2001) }])).toMatchObject({ ok: false });
    expect(applyChanges(p.content, [{ block: p.heading, text: "  " }])).toMatchObject({ ok: false });
    // A row's id is not a block's.
    expect(applyChanges(p.content, [{ block: p.content.rows[0].id, text: "x" }])).toMatchObject({ ok: false });
  });

  it("makes a test of the block when one is changed, and of the page when several are", () => {
    expect(partOf([{ block: "b1", text: "x" }])).toEqual({ kind: "block", id: "b1" });
    expect(partOf([{ block: "b1", text: "x" }, { block: "b2", text: "y" }])).toBeNull();
    expect(partOf([])).toBeNull();
  });
});
