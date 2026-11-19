import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { check } from "../../scripts/decisions.mjs";

/**
 * Every decision is a file docs/decisions/D<n>.md, and docs/decisions.md is its index: one short row per decision between two
 * markers, written by `node scripts/decisions.mjs write` (bloat review step 2.40). A number is used once and is taken by
 * `node scripts/claim-decision.mjs "title"` before it is cited; the file it leaves holds only its title and date until its text
 * is written.
 */
const root = process.cwd();
const lines = readFileSync(path.join(root, "docs", "decisions.md"), "utf8").split("\n");
const folder = path.join(root, "docs", "decisions");
const files = readdirSync(folder).filter((name) => /^D\d+\.md$/.test(name));
const ROW = /^\| D\d+ \|/;
const FIX = "run node scripts/decisions.mjs write; a decision's text goes in docs/decisions/D{n}.md, lines under 500 characters";

describe("docs/decisions.md", () => {
  it("keeps every decision row in one run between the index markers, under the index header", () => {
    const at = lines.flatMap((line, i) => (ROW.test(line) ? [i] : []));
    expect(at.length).toBeGreaterThan(0);
    const broken = at.filter((n, i) => i > 0 && n !== at[i - 1] + 1);
    expect(broken, `A decision row stands apart from the index: ${FIX}.`).toEqual([]);
    expect(lines[at[0] - 3], FIX).toBe("<!-- decisions:index -->");
    expect(lines[at[0] - 2]).toBe("| # | Decision | Date | Text |");
    expect(lines[at[0] - 1]).toBe("|---|---|---|---|");
    expect(lines[at[at.length - 1] + 1]).toBe("<!-- /decisions:index -->");
  });

  it("uses no decision number twice, in the index or in the files", () => {
    const ids = lines.flatMap((line) => /^\| (D\d+) \|/.exec(line)?.[1] ?? []);
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(twice, "Two decisions share a number: the later one takes a new number with node scripts/claim-decision.mjs.").toEqual([]);
    const numbers = files.map((name) => Number(/^D(\d+)\.md$/.exec(name)?.[1]));
    expect(new Set(numbers).size, "Two files share a number.").toBe(numbers.length);
  });

  it("gives a claimed number its text within 14 days", () => {
    const now = Date.now();
    const stale = files.filter((name) => {
      const text = readFileSync(path.join(folder, name), "utf8");
      const stub = /\(claimed (\d{4}-\d{2}-\d{2}), text follows\)/.exec(text)?.[1];
      // A stub claimed before the split says so in its text; one claimed after it is a title and a date and nothing else.
      const bare = text.split("\n").filter((line) => line.trim() !== "");
      const date = stub ?? (bare.length === 2 ? /^Date: (\d{4}-\d{2}-\d{2})$/.exec(bare[1])?.[1] : undefined);
      return date !== undefined && now - Date.parse(`${date}T00:00:00Z`) >= 14 * 86_400_000;
    });
    expect(stale, "A claimed decision has had no text for 14 days: write it in its file, or let the number go.").toEqual([]);
  });

  it("passes what node scripts/decisions.mjs check passes", () => {
    expect(check(), FIX).toEqual([]);
  });

  it("holds no decision file over 200,000 bytes", () => {
    const names = [...readdirSync(folder).map((name) => `docs/decisions/${name}`), "docs/decisions.md"];
    const big = names.filter((name) => statSync(path.join(root, name)).size > 200_000);
    expect(big, FIX).toEqual([]);
  });

  it("has one file for every index row", () => {
    const rows = lines.filter((line) => ROW.test(line)).length;
    expect(files.length, FIX).toBe(rows);
  });
});
