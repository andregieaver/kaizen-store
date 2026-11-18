import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md keeps a map of the rule files, not a line per rule (bloat review step 2.1). The rules are in full as headings in
 * `docs/rules/storefront.md` and the files of `docs/rules/admin/` (PSI CODE-05); a rule is found by searching `docs/rules`. Each heading
 * is unique, so a search for it finds one rule.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const headingsIn = (files: string[]) => files.flatMap((file) => read(file).split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim()));

const adminDir = "docs/rules/admin";
const files = [
  "docs/rules/storefront.md",
  ...readdirSync(path.join(root, adminDir))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => `${adminDir}/${f}`),
];

describe("the rules in full and CLAUDE.md's map (PSI CODE-05, bloat review 2.1)", () => {
  it("gives every rule a heading of its own", () => {
    const all = headingsIn(files);
    expect(all.filter((heading, i) => all.indexOf(heading) !== i)).toEqual([]);
    expect(all.length).toBeGreaterThan(250);
  });

  it("CLAUDE.md maps every rule file", () => {
    const lines = read("CLAUDE.md").split("\n");
    const start = lines.indexOf("## Rules by area");
    expect(start, "CLAUDE.md has no section '## Rules by area'").toBeGreaterThanOrEqual(0);
    const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
    const section = lines.slice(start + 1, next < 0 ? lines.length : next);
    const text = section.join("\n");
    expect(files.filter((file) => !text.includes(file))).toEqual([]);
    expect(section.length).toBeLessThanOrEqual(20);
  });

  it("lists every file of docs/rules/admin/ in its README", () => {
    const dir = path.join(root, "docs/rules/admin");
    const readme = read("docs/rules/admin/README.md");
    expect(readdirSync(dir).filter((f) => f !== "README.md" && !readme.includes(`(${f})`))).toEqual([]);
  });
});
