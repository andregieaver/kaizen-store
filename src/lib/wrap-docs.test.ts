import { describe, expect, it } from "vitest";

import { longLines, sameWords, wrapText, WIDTH } from "../../scripts/lib/wrap-docs.mjs";

const words = (n: number) => "word ".repeat(n).trimEnd();

describe("wrapText", () => {
  it("wraps a long bullet with a two-space continuation", () => {
    const text = `- ${words(180)}`;
    const out = wrapText(text);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[0].startsWith("- ")).toBe(true);
    for (const line of lines.slice(1)) expect(line.startsWith("  ") && !line.startsWith("   ")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(WIDTH);
    expect(sameWords(text, out)).toBe(true);
  });

  it("indents a numbered item by the width of its marker", () => {
    const text = `12. ${words(180)}`;
    const lines = wrapText(text).split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line.startsWith("    ") && !line.startsWith("     ")).toBe(true);
  });

  it("leaves a table row alone", () => {
    const row = `| ${words(180)} |`;
    expect(wrapText(row)).toBe(row);
  });

  it("leaves a fenced block alone", () => {
    const text = `\`\`\`\n${words(180)}\n\`\`\``;
    expect(wrapText(text)).toBe(text);
  });

  it("never breaks inside a code span", () => {
    const span = `\`${"ab ".repeat(100).trimEnd()}\``;
    const text = `- ${words(20)} ${span} ${words(60)}`;
    const out = wrapText(text);
    expect(sameWords(text, out)).toBe(true);
    expect(out).toContain(span);
  });

  it.each(["- ", "1. ", "# "])("never starts a continuation line with %s", (marker) => {
    for (let pad = 100; pad < 140; pad++) {
      const text = `- ${"x".repeat(pad)} ${marker}${words(150)}`;
      const out = wrapText(text);
      expect(sameWords(text, out)).toBe(true);
      for (const line of out.split("\n").slice(1)) expect(line.trimStart().startsWith(marker)).toBe(false);
    }
  });

  it("keeps a 400-character line", () => {
    const line = `- ${words(79)}`;
    expect(line.length).toBeLessThan(500);
    expect(wrapText(line)).toBe(line);
  });

  it("wraps a blockquote without a leading '>' on later lines", () => {
    const text = `> ${words(180)}`;
    const out = wrapText(text);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line.startsWith(">")).toBe(false);
    expect(sameWords(text, out)).toBe(true);
  });

  it("is idempotent", () => {
    const text = `- ${words(180)}\n\n1. ${words(150)}\n> ${words(150)}`;
    expect(wrapText(wrapText(text))).toBe(wrapText(text));
  });
});

describe("longLines", () => {
  it("counts one prose and one table line", () => {
    const text = `${words(120)}\n| ${words(120)} |\nshort`;
    expect(longLines(text)).toEqual({ prose: 1, table: 1, unbreakable: 0 });
  });

  it("reports a long line that is one code span as unbreakable, and still fails one with spaces outside its code", () => {
    const span = `  \`${"a b ".repeat(150).trimEnd()}\``;
    expect(span.length).toBeGreaterThan(500);
    expect(longLines(span)).toEqual({ prose: 0, table: 0, unbreakable: 1 });
    const spaced = `- ${words(120)}`;
    expect(spaced.length).toBeGreaterThan(500);
    expect(longLines(spaced)).toEqual({ prose: 1, table: 0, unbreakable: 0 });
  });
});
