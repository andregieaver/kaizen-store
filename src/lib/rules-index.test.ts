import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md keeps one line per rule; the rule is in full under the same words as a heading in `docs/rules/storefront.md` or a file of
 * `docs/rules/admin/` (PSI CODE-05). A line without its heading, or a heading without its line, fails here, so the two never drift.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** The bullet lines of one `## ` section of CLAUDE.md, without the dash and without a trailing "…" where the line was shortened. */
function linesOf(section: string): string[] {
  const text = read("CLAUDE.md");
  const start = text.indexOf(`\n## ${section}\n`);
  if (start < 0) throw new Error(`No section ${section} in CLAUDE.md`);
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  return (end < 0 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/…$/, "").trim());
}

const headingsIn = (files: string[]) => files.flatMap((file) => read(file).split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim()));

function check(lines: string[], headings: string[]) {
  const unmatched = lines.filter((line) => headings.filter((h) => h.startsWith(line)).length !== 1);
  const orphans = headings.filter((h) => !lines.some((line) => h.startsWith(line)));
  return { unmatched, orphans };
}

describe("CLAUDE.md's rule lines and the rules in full (PSI CODE-05)", () => {
  it("gives every admin line exactly one heading in docs/rules/admin/, and every heading there a line", () => {
    const dir = "docs/rules/admin";
    const files = readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => `${dir}/${f}`);
    expect(check(linesOf("Admin"), headingsIn(files))).toEqual({ unmatched: [], orphans: [] });
  });

  it("does the same for the storefront's rules", () => {
    expect(check(linesOf("Storefront"), headingsIn(["docs/rules/storefront.md"]))).toEqual({ unmatched: [], orphans: [] });
  });

  it("lists every file of docs/rules/admin/ in its README", () => {
    const dir = path.join(root, "docs/rules/admin");
    const readme = read("docs/rules/admin/README.md");
    expect(readdirSync(dir).filter((f) => f !== "README.md" && !readme.includes(`(${f})`))).toEqual([]);
  });
});
