import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import baseline from "./docs-budget.baseline.json";

/**
 * CLAUDE.md is loaded by every session, so its core is held at its size (bloat review step 0.43, `docs/rules/budgets.md`): the bytes
 * outside its Storefront and Admin index only fall, an index line is at most 200 characters, and prose cannot be added inside the
 * index to get round that. Step 1.1 of `docs/audits/bloat-review-2026-11.md` adds the repository's other numbers to the baseline file,
 * and step 2.1 replaces the first case when the index leaves CLAUDE.md.
 */
const root = process.cwd();
const text = readFileSync(path.join(root, "CLAUDE.md"), "utf8");

const START = "\n## Storefront\n";
const END = "\n## Conventions\n";

function bounds(doc: string): { start: number; end: number } {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start < 0 || end < 0 || end < start) throw new Error("CLAUDE.md has no Storefront or Conventions section");
  return { start, end };
}

/** The bytes of CLAUDE.md outside its Storefront and Admin index. */
function outsideIndex(doc: string): number {
  const { start, end } = bounds(doc);
  return Buffer.byteLength(doc.slice(0, start)) + Buffer.byteLength(doc.slice(end));
}

/** The rule lines of the index. */
function indexLines(doc: string): string[] {
  const { start, end } = bounds(doc);
  return doc
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("- "));
}

describe("CLAUDE.md's core is held at its size (bloat review step 0.43)", () => {
  const now = outsideIndex(text);

  it("CLAUDE.md outside its index does not grow", () => {
    expect(
      now,
      `CLAUDE.md outside its Storefront and Admin index grew from ${baseline.claudeOutsideIndex} to ${now} bytes. Put the sentence in docs/rules/budgets.md or in the rule's own file under docs/rules.`,
    ).toBeLessThanOrEqual(baseline.claudeOutsideIndex);
  });

  it("the baseline is as low as the file", () => {
    expect(baseline.claudeOutsideIndex, `CLAUDE.md shrank: set claudeOutsideIndex in src/lib/docs-budget.baseline.json to ${now} in this change.`).toBe(now);
  });

  it("an index line is at most 200 characters", () => {
    expect(indexLines(text).filter((line) => [...line].length > 200)).toEqual([]);
  });

  it("the index holds only rule lines and its two introductions", () => {
    const { start, end } = bounds(text);
    const prose = text
      .slice(start, end)
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("- ") && !line.startsWith("## "));
    expect(prose).toHaveLength(2);
  });

  it("would notice a sentence added outside the index", () => {
    const planted = text.replace(END, `${END}- A planted sentence of forty bytes or so.\n`);
    expect(outsideIndex(planted)).toBeGreaterThan(baseline.claudeOutsideIndex);
  });

  it("does not count a new rule's index line", () => {
    const planted = text.replace("\n\n## Admin\n", "\n- A new rule (D999, `src/lib/new-rule.ts`)\n\n## Admin\n");
    expect(planted).not.toBe(text);
    expect(outsideIndex(planted)).toBe(outsideIndex(text));
  });
});
