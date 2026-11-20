import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TAXONOMY_LANGS } from "@/lib/product-taxonomy";

/**
 * The taxonomy's files reach a server function only through Turbopack's own trace (bloat review step 2.23): next.config.ts carries no
 * include for them, because in Next 16.4 an exclude cannot remove what an include adds. The trace follows a read whose path is
 * `path.join(process.cwd(), "src/data/product-taxonomy", "<file>")` with literal parts; a path built from a variable or a template is
 * traced as a guess or not at all, and the route that reads it fails in production with ENOENT. So every read in the reader has that
 * form, and every data file has its read.
 */
const root = process.cwd();
const READER = "src/server/product-taxonomy.ts";
const FOLDER = "src/data/product-taxonomy";
const WHY =
  "Turbopack traces the taxonomy beside a function only when the reader names each file literally: readFile(path.join(process.cwd(), \"src/data/product-taxonomy\", \"<file>.json\"), \"utf8\"). A path from a variable, a template or a shared folder constant is not followed, and the route fails in production with ENOENT (bloat review step 2.23).";

const LITERAL = /^path\.join\(process\.cwd\(\), "src\/data\/product-taxonomy", "([a-z-]+\.json)"\)$/;

/** Each `readFile(` call's first argument as written, and the files the literal ones name; `bad` holds the arguments of another form. */
function readsOf(text: string): { files: string[]; bad: string[] } {
  const files: string[] = [];
  const bad: string[] = [];
  for (const match of text.matchAll(/\breadFile(?:Sync)?\(/g)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (at < text.length && depth > 0) {
      const ch = text[at];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) break;
      at++;
    }
    const argument = text.slice(start, depth === 0 ? at - 1 : at).trim();
    const literal = LITERAL.exec(argument);
    if (literal) files.push(literal[1]);
    else bad.push(argument);
  }
  return { files, bad };
}

describe("the taxonomy's reader names each file literally (bloat review 2.23)", () => {
  // Comments aside: the reader's own comment shows the form.
  const text = readFileSync(path.join(root, READER), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("every read is path.join(process.cwd(), the folder, a literal file)", () => {
    const { bad } = readsOf(text);
    expect(bad, `${READER}: ${WHY}`).toEqual([]);
  });

  it("every data file of the release has its literal read", () => {
    const data = readdirSync(path.join(root, FOLDER))
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(data).toEqual(["structure.json", ...TAXONOMY_LANGS.map((lang) => `names-${lang}.json`)].sort());
    expect([...new Set(readsOf(text).files)].sort(), `${READER} must read each of ${data.join(", ")}: ${WHY}`).toEqual(data);
  });

  it("next.config.ts does not trace the folder into every route again", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(
      config.includes(FOLDER),
      "an include of src/data/product-taxonomy puts 13 MB beside every function, and no exclude can take it off again: the trace of the reader carries the files",
    ).toBe(false);
  });

  it("notices a path built from a variable", () => {
    const planted = 'const DIR = path.join(process.cwd(), "src/data/product-taxonomy");\nreadFile(path.join(DIR, file), "utf8");\nreadFile(path.join(process.cwd(), "src/data/product-taxonomy", `names-${lang}.json`), "utf8");';
    expect(readsOf(planted).bad).toHaveLength(2);
    expect(readsOf('readFile(path.join(process.cwd(), "src/data/product-taxonomy", "names-en.json"), "utf8")')).toEqual({ files: ["names-en.json"], bad: [] });
  });
});
