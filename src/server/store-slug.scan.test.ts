import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A store's address by its id is read through `storeSlugOf()` (`src/server/stores.ts`: cached for days under `storeIdTag(id)`, marked
 * stale when a sandbox is kept, the one time an address changes), never by a hand-written `select slug from commerce.stores where id`
 * (step 0.20 of the bloat review: it was production's most-called statement, written on 27 lines). The two support reads also ask
 * `commerce.store_is_active(id)`, which must stay live, so they keep their own.
 */

const ROOT = process.cwd();
const HAND_WRITTEN = /select slug from commerce\.stores where id/;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("a store's address by its id", () => {
  it("is read through storeSlugOf(), not written by hand", () => {
    const holders = sources("src")
      .map((path) => relative(ROOT, join(ROOT, path)))
      .filter((path) => HAND_WRITTEN.test(readFileSync(join(ROOT, path), "utf8")))
      .sort();
    expect(
      holders,
      "read a store's address by its id through storeSlugOf() (src/server/stores.ts); the two support reads also ask commerce.store_is_active(id) and stay live",
    ).toEqual(["src/server/stores.ts", "src/server/support-forms.ts", "src/server/support-inbound.ts"]);
  });
});
