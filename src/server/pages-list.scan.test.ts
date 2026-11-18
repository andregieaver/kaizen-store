import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `listPublishedPages()` selects every published page with its whole document. One page is `publishedPageById()`, addresses and titles
 * are `publishedPageIndex()`; the whole list stays only where every document is drawn or read (bloat review step 0.24).
 */

const ROOT = process.cwd();
const CALL = /listPublishedPages\(/;

/**
 * The files that may name it: the definition, and the sitemaps and llms.txt, which read the pictures and the words of every page (bloat
 * review step 2.17: the blog feed reads articleCards(), the platform's static params and the admin's search page the index).
 */
const ALLOWED = ["src/server/pages.ts", "src/server/seo.ts"].sort();

/** The definition, and in seo.ts its four readers' two lines each and one comment (step 2.17; 14 after step 0.24). */
const MAX_LINES = 10;
const MESSAGE = "one page: publishedPageById(); addresses and titles: publishedPageIndex(); the whole list only where every document is drawn or read";

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const hits = sources("src").flatMap((path) =>
  readFileSync(join(ROOT, path), "utf8")
    .split("\n")
    .flatMap((line, index) => (CALL.test(line) ? [{ path, line: index + 1, text: line }] : [])),
);

describe("the published-page list", () => {
  it("is named only by the files that draw or read every document", () => {
    expect([...new Set(hits.map((hit) => hit.path))].sort(), MESSAGE).toEqual(ALLOWED);
  });

  it("is named on at most 10 lines", () => {
    expect(hits.length, MESSAGE).toBeLessThanOrEqual(MAX_LINES);
  });

  it("is never used to pick one page", () => {
    expect(hits.filter((hit) => hit.text.includes(".find(")).map((hit) => `${hit.path}:${hit.line}`), MESSAGE).toEqual([]);
  });
});
