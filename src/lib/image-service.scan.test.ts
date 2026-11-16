import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Pictures are never resized on the server (D336): uploaded pictures live on the storage host, which Next's image service refuses, so a
 * tag without `unoptimized` shows nothing. The config turns the service off; every tag says so too.
 */
const ROOT = process.cwd();

/** The `<Image …/>` tags of next/image in a file's text that lack `unoptimized`. */
function tagsWithoutUnoptimized(text: string): string[] {
  if (!/import\s+(?:\w+\s*,\s*)?\{?[^;]*\bImage\b[^;]*from\s+["']next\/image["']/.test(text) && !/import\s+Image\s+from\s+["']next\/image["']/.test(text)) return [];
  const found: string[] = [];
  const open = /<Image\s/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const end = text.indexOf("/>", m.index);
    const tag = text.slice(m.index, end === -1 ? undefined : end + 2);
    if (!/\bunoptimized\b/.test(tag)) found.push(tag);
  }
  return found;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("pictures are served as stored", () => {
  it("turns Next's image service off in the config", () => {
    expect(readFileSync(join(ROOT, "next.config.ts"), "utf8")).toMatch(/images:\s*\{\s*unoptimized:\s*true\s*\}/);
  });

  it("has `unoptimized` on every next/image tag", () => {
    for (const file of tsxFiles(join(ROOT, "src"))) {
      const bad = tagsWithoutUnoptimized(readFileSync(file, "utf8"));
      expect(bad, `${file} has a next/image tag without unoptimized`).toEqual([]);
    }
  });

  it("would notice a tag without it", () => {
    const text = 'import Image from "next/image";\n<Image src={a} alt="" width={36} height={36} />';
    expect(tagsWithoutUnoptimized(text)).toHaveLength(1);
  });
});
