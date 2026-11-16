import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A site's AI settings refresh that site's tag only (bloat review step 0.21): `saveAiSettings()` and `removeAiSettings()` refresh
 * `aiTag(storeId)` themselves, so a store's admin never names the platform's tag (which would expire every store's pages that answer with
 * Kaizena Flow's provider), and the old platform-wide tag string never comes back.
 */

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the AI tag is per site", () => {
  it("no file of a store's admin names the platform's AI tag", () => {
    const files = sources("src/app/admin/(gated)/[store]");
    expect(files.length).toBeGreaterThan(50);
    const naming = files.filter((path) => /\bAI_TAG\b|\baiTag\(\s*null\s*\)/.test(read(path)));
    expect(naming).toEqual([]);
  });

  it("no source file tags with the old platform-wide string", () => {
    const quoted = sources("src").filter((path) => /["'`]ai-providers["'`]/.test(read(path)));
    expect(quoted).toEqual([]);
  });
});
