import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * docs/decisions.md holds every decision as one row of one table, and a number is used once (bloat review step 0.41). A number is
 * taken by `node scripts/claim-decision.mjs "title"` before it is cited; the row it leaves says "(claimed <date>, text follows)"
 * until its text is written.
 */
const lines = readFileSync(path.join(process.cwd(), "docs", "decisions.md"), "utf8").split("\n");
const ROW = /^\| D\d+ \|/;

describe("docs/decisions.md", () => {
  it("every decision row is in the Settled table", () => {
    const at = lines.flatMap((line, i) => (ROW.test(line) ? [i] : []));
    expect(at.length).toBeGreaterThan(0);
    const broken = at.filter((n, i) => i > 0 && n !== at[i - 1] + 1);
    expect(broken, "A decision row stands apart from the table: move it into the one run of rows.").toEqual([]);
    expect(lines[at[0] - 2]).toBe("| # | Decision | Date | Consequence |");
    expect(lines[at[0] - 1]).toBe("|---|---|---|---|");
  });

  it("no decision number is used twice", () => {
    const ids = [...lines.join("\n").matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]);
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(twice, "Two decisions share a number: the later one takes a new number with node scripts/claim-decision.mjs.").toEqual([]);
  });

  it("a claimed number gets its text within 14 days", () => {
    const now = Date.now();
    const stale = lines.filter((line) => {
      if (!line.includes("(claimed ") || !line.includes("text follows)")) return false;
      const date = /\(claimed (\d{4}-\d{2}-\d{2}), text follows\)/.exec(line)?.[1];
      return date !== undefined && now - Date.parse(`${date}T00:00:00Z`) >= 14 * 86_400_000;
    });
    expect(stale.map((line) => line.slice(0, 40))).toEqual([]);
  });
});
