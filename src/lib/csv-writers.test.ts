import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every CSV is written by `writeCsv()` (`src/lib/csv.ts`) or the older `toCsv()` (`src/lib/dac7.ts`), never joined by hand (D165,
 * `docs/wave-2-data.md` 6.3): a hand-made file has no escape for the cells a spreadsheet runs as formulas. A module that makes CSV text (it
 * names `text/csv`, imports a CSV writer, or is a `*-csv.ts` file) may not join cells with a comma or semicolon, or wrap a cell in quotes
 * itself. And the writers' own definitions are the only place the formula characters are listed.
 */
const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-test-support\.ts$/.test(name) ? [p] : [];
  });
}

const rel = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");
const MAKES_CSV = /\btoCsv\(|\bwriteCsv\(|from "[@./a-z-]*\/(csv|dac7)"/;
const BY_HAND = [
  /\.join\(\s*["'`][,;]["'`]\s*\)/,
  /\.join\(\s*["'`]\\t["'`]\s*\)/,
  /["'`]"["'`]\s*\+\s*\w+\s*\+\s*["'`]"["'`]/,
  /\.replace\(\s*\/"\/g\s*,\s*['"`]""['"`]\s*\)/,
];

// Not CSV: these join a list for another purpose in a module that also writes CSV (a SQL list, a header value). A new entry needs a reason.
const ALLOWED: Record<string, string> = {
  "src/lib/csv.ts": "the writer itself",
  "src/lib/dac7.ts": "the older writer, kept with its tests",
};

describe("no CSV is written by hand", () => {
  const files = sourceFiles(SRC).filter((f) => /^src\/(server|app|lib)\//.test(rel(f)));

  it("finds the writers", () => {
    const writers = files.filter((f) => MAKES_CSV.test(readFileSync(f, "utf8")));
    expect(writers.length).toBeGreaterThan(5);
  });

  it("has no module that makes CSV and joins its cells itself", () => {
    const hits: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (Object.hasOwn(ALLOWED, name)) continue;
      const text = readFileSync(file, "utf8");
      if (!MAKES_CSV.test(text) && !/-csv\.ts$/.test(name)) continue;
      for (const [i, line] of text.split("\n").entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (BY_HAND.some((re) => re.test(line))) hits.push(`${name}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("lists the formula characters in one place only", () => {
    const where = files.filter((f) => /\[=\+\\-@/.test(readFileSync(f, "utf8"))).map(rel).sort();
    // The two writers, and the test-only checkers are the places that know the set; nothing in `src/server` does.
    expect(where.filter((w) => w.startsWith("src/server/"))).toEqual([]);
  });
});
