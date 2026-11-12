import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Heavy packages load where they are used: loadSharp(), launchBrowser(), await import() (bloat review step 0.5). A static value
 * import of one of them at the top of a server module puts its native code on every route that module reaches.
 */
const ROOT = join(process.cwd(), "src");
const PACKAGES = ["sharp", "opentype.js", "playwright-core", "@sparticuz/chromium", "mammoth", "unpdf"];

/** Every static value import of a heavy package in the text: `import type` and an import of only `type X` names are allowed. */
function problems(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/^import\s+([^;]*?)\s*from\s*["']([^"']+)["'];?/gm)) {
    const [, clause, source] = m;
    if (!PACKAGES.includes(source)) continue;
    if (/^type\s/.test(clause)) continue;
    const braces = clause.match(/^\{([^}]*)\}$/);
    if (braces && braces[1].split(",").map((s) => s.trim()).filter(Boolean).every((name) => name.startsWith("type "))) continue;
    found.push(source);
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.includes(".spec.") ? [path] : [];
  });
}

const files = walk(ROOT).map((path) => ({ file: relative(process.cwd(), path), text: readFileSync(path, "utf8") }));

describe("heavy packages", () => {
  it("are imported statically as a value nowhere in src outside tests", () => {
    const list = files.flatMap(({ file, text }) => problems(text).map((pkg) => `${file}: ${pkg}`));
    expect(list).toEqual([]);
  });

  it("have sharp loaded by src/server/sharp-load.ts alone", () => {
    expect(files.filter(({ text }) => text.includes('import("sharp")')).map(({ file }) => file)).toEqual(["src/server/sharp-load.ts"]);
  });

  it("are found by the checker where a file imports them", () => {
    expect(problems('import sharp from "sharp";')).toEqual(["sharp"]);
    expect(problems('import sharp, { type Sharp } from "sharp";')).toEqual(["sharp"]);
    expect(problems('import { parse, type Font } from "opentype.js";')).toEqual(["opentype.js"]);
    expect(problems('import type { Sharp } from "sharp";')).toEqual([]);
    expect(problems('import { type Sharp } from "sharp";')).toEqual([]);
  });
});
