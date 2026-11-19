import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { check, fileOf, fold, indexRow, newDecision, write, oldRows, parseRow, prove, wrapParagraph } from "../../scripts/decisions.mjs";

/** Fixture rows, never the real file: the shapes the old table has. */
const FOUR = "| D1 | **A Norwegian company shipping from Norway.** Norway is home. | 2026-09-23 | Sales to Sweden are exports (see below). |";
const TWO = "| D2 | **A two-cell row.** Its whole text is here, with no date. |";
const CODE_PIPE = "| D3 | **A pipe in code.** Run `a | b` to see it, then `x || y`. | 2026-10-01 | The consequence. |";
const ESCAPED = "| D4 | **An escaped pipe.** Say a \\| b in plain text. | 2026-10-02 | Done. |";
const GLUED = "| D6 | **No space after the bar.** Text. | 2026-11-18 |Migration versions: none. |";
const sentence = "Every word of this sentence counts, and the split must keep each one of them in its place. ";
const LONG = `| D5 | **A very long row.** ${sentence.repeat(200)}Last words. | 2026-10-03 | ${"Consequence words here. ".repeat(60)}|`;

describe("splitting a decision row into its file (bloat review step 2.40)", () => {
  it.each([
    ["a 4-cell row", FOUR],
    ["a 2-cell row", TWO],
    ["a pipe inside a code span", CODE_PIPE],
    ["an escaped pipe", ESCAPED],
    ["a bar glued to the consequence", GLUED],
    ["a row of 18,000 characters", LONG],
  ])("makes a file with every word of %s and no line over 500", (_name, row) => {
    expect(row.length).toBeGreaterThan(0);
    const file = fileOf(row);
    expect(file.text.startsWith(`# ${file.id}: `)).toBe(true);
    for (const line of file.text.split("\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(500);
    expect(() => prove(row, file.text)).not.toThrow();
  });

  it("is 18,000 characters long in the long case", () => {
    expect(LONG.length).toBeGreaterThan(18_000);
  });

  it("keeps a pipe inside a code span in its cell", () => {
    expect(parseRow(CODE_PIPE).cells).toHaveLength(4);
    expect(fileOf(CODE_PIPE).text).toContain("`a | b`");
  });

  it("never breaks inside a code span", () => {
    const span = `\`${"word ".repeat(40)}end\``;
    const text = `${"x".repeat(450)} ${span} tail`;
    for (const line of wrapParagraph(text, "D9").split("\n")) expect((line.match(/`/g) ?? []).length % 2).toBe(0);
  });

  it("breaks after a sentence end when one is in reach", () => {
    const text = `${"a".repeat(300)}. Next sentence ${"b".repeat(300)}`;
    expect(wrapParagraph(text, "D9").split("\n")[0]).toBe(`${"a".repeat(300)}.`);
  });

  it("fails the proof when one character of the text is altered after the split", () => {
    const text = fileOf(FOUR).text;
    expect(() => prove(FOUR, text.replace("Norway is home", "Norway is hone"))).toThrow(/D1: the file differs from the row/);
    expect(() => prove(LONG, fileOf(LONG).text.replace("Last words", "Last wordz"))).toThrow(/D5/);
  });

  it("refuses a 4-cell row whose date cell is not a date, a pipe having been misplaced", () => {
    const misplaced = "| D7 | **Text** has a stray | bar in it. | 2026-10-04 | Consequence. |";
    expect(() => fileOf(misplaced)).toThrow(/D7/);
    expect(() => parseRow("| D8 | **Text** | 2026-1-4 | Consequence. |")).toThrow(/D8: the third cell/);
  });

  it("finds only rows written the old way", () => {
    const text = ["# Decisions", FOUR, indexRow(9, "Nine", "2026-11-19"), TWO].join("\n");
    expect(oldRows(text).map((row: { i: number }) => row.i)).toEqual([1, 3]);
  });

  it("cuts an index row to 190 characters and keeps it to one table row", () => {
    const row = indexRow(12, `A title | with a bar and \`code\` ${"long ".repeat(80)}`, "2026-11-19");
    expect(row.length).toBeLessThanOrEqual(190);
    expect(row.startsWith("| D12 | **")).toBe(true);
    expect(row.endsWith("| [text](decisions/D12.md) |")).toBe(true);
    expect(row).not.toContain("`");
    expect(indexRow(5, "Short", "")).toBe("| D5 | **Short** |  | [text](decisions/D5.md) |");
  });

  it("turns a row written the old way into its file with fold, and refuses to drop it with write", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "decisions-"));
    try {
      mkdirSync(path.join(root, "docs", "decisions"), { recursive: true });
      writeFileSync(path.join(root, "docs", "decisions", "D1.md"), "# D1: First\n\nFirst text.\n\nDate: 2026-01-01\n");
      const base = ["# Decisions", "", "<!-- decisions:index -->", "<!-- /decisions:index -->", "", "## Open", ""].join("\n");
      writeFileSync(path.join(root, "docs", "decisions.md"), base);
      write(root);
      expect(check(root)).toEqual([]);
      const old = "| D2 | **Old way.** Written as a whole row. | 2026-02-02 | Its consequence. |";
      writeFileSync(path.join(root, "docs", "decisions.md"), readFileSync(path.join(root, "docs", "decisions.md"), "utf8").replace("<!-- /decisions:index -->", `${old}\n<!-- /decisions:index -->`));
      expect(check(root).join("\n")).toMatch(/D2 is written into docs\/decisions.md as a whole row: run node scripts\/decisions.mjs fold/);
      expect(() => write(root)).toThrow(/fold/);
      fold(root);
      expect(check(root)).toEqual([]);
      expect(readFileSync(path.join(root, "docs", "decisions", "D2.md"), "utf8")).toBe("# D2: Old way\n\n**Old way.** Written as a whole row.\n\nDate: 2026-02-02\n\nIts consequence.\n");
      expect(newDecision("A new one.", "2026-03-03", root)).toBe("D3");
      expect(readFileSync(path.join(root, "docs", "decisions", "D3.md"), "utf8")).toBe("# D3: A new one.\n\nDate: 2026-03-03\n");
      expect(check(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
