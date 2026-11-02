import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ON_UNLESS_OFF } from "./page-rows";

/**
 * A component's setting that is on unless it is `false` (`block.x !== false`) is kept when it is `false`, or unticking it does
 * nothing: the builder's merge takes a `false` out unless its key is in `ON_UNLESS_OFF` (`src/lib/page-rows.ts`). A brands
 * component's *Show the names* and a gallery's captions and lightbox were missing and could not be turned off.
 */

const DIRS = ["src/components", "src/lib", "src/app"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("settings on unless off", () => {
  it("every block setting read as `!== false` keeps its `false` when the builder merges it", () => {
    const keys = new Set<string>();
    for (const file of DIRS.flatMap(files)) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bblock\.([a-zA-Z]+) !== false/g)) keys.add(match[1]);
    }
    expect(keys.size).toBeGreaterThan(5);
    expect([...keys].filter((key) => !ON_UNLESS_OFF.has(key)).sort()).toEqual([]);
  });
});
