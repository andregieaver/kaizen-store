import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A change to a store reaches its pages only when `getStore()`'s cache tag is refreshed (`storeTag(slug)`, PSI 2026-10-24 DATA-02):
 * a module that writes `commerce.stores` refreshes it itself (`refreshTag(storeTag(slug))`, which works from an action, a job and
 * the AI manager alike, or `refreshStoreById()` where it knows only the id) or is listed below. The list is the modules that relied on their callers when the check began; it only
 * shrinks: a listed module that now refreshes or no longer writes fails until it is taken off, and a new writer is never added.
 */

const ROOT = process.cwd();
const WRITES_STORES = /\b(update|insert\s+into)\s+commerce\.stores\b/i;
/** A refresh of the store's tag, directly or through the helpers that include it. */
const REFRESHES = /\bstoreTag\(|\bstoreTags\(|\bdesignTags\(|\brefreshStoreById\(/;
/** Test support writes stores to arrange a case; nothing is cached there. */
const TEST_SUPPORT = /(fixture|test-support)\.ts$/;

/** Writers whose callers (the server action or tool that runs them) refresh the tag. Take a module off when it refreshes itself. */
const REFRESHED_BY_CALLERS = new Set([
  // `ensureStoreRoles()` runs while the Team and Roles pages render, where a tag cannot be refreshed, and it writes only
  // `role_templates_offered`, which `getStore()` does not read.
  "src/server/store-roles.ts",
]);

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const writers = ["src/server", "src/app", "src/lib", "src/components"]
  .flatMap(sources)
  .map((path) => relative(ROOT, join(ROOT, path)))
  .filter((path) => !TEST_SUPPORT.test(path) && WRITES_STORES.test(read(path)))
  .sort();

describe("writers of commerce.stores refresh the store's cache", () => {
  it("finds the writers", () => {
    expect(writers.length).toBeGreaterThan(5);
  });

  it.each(writers)("%s refreshes storeTag or is listed", (path) => {
    if (REFRESHED_BY_CALLERS.has(path)) return;
    expect(REFRESHES.test(read(path)), `${path} writes commerce.stores without refreshing storeTag(slug)`).toBe(true);
  });

  it("lists only writers that still rely on their callers", () => {
    for (const path of REFRESHED_BY_CALLERS) {
      expect(writers, `${path} no longer writes commerce.stores: take it off the list`).toContain(path);
      expect(REFRESHES.test(read(path)), `${path} refreshes storeTag itself now: take it off the list`).toBe(false);
    }
  });
});
