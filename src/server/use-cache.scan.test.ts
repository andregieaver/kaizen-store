import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every cached read says how long it lives and under which tags (bloat review step 1.11, SD-13, CA-16).
 *
 * Part 1 lists each function whose body starts with the directive "use cache" with its `cacheLife()` and `cacheTag()` arguments and
 * compares the table to the baseline file, so a changed life or tag fails and shows in review as a changed line. Part 2 asks that every one
 * calls both, but the functions named in NO_LIFE and NO_TAG (each with its reason; the lists only shrink). Part 3 holds that a
 * store's admin refreshes no tag that names no store, but the files in PLATFORM_TAG_FROM_STORE (the list only shrinks).
 * Part 4 shows the parser notices what it is there for.
 */

const ROOT = process.cwd();

export type CachedRead = { life: string | null; tags: string[] };

/** A line that is exactly the directive: "use cache", or one with a suffix such as "use cache: remote". */
const DIRECTIVE = /^\s*["']use cache(: [a-z]+)?["'];?\s*$/;
const FUNCTION_HEAD = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;

/** The arguments of every call `name(`...`)` in `body`, each with its white space collapsed. */
function callArgs(body: string, name: string): string[] {
  const found: string[] = [];
  const call = new RegExp(`\\b${name}\\(`, "g");
  for (let m = call.exec(body); m; m = call.exec(body)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") depth--;
    }
    found.push(body.slice(start, i - 1).replace(/\s+/g, " ").trim());
  }
  return found;
}

/** The cached reads of one source file: functions at the top level whose first statement is the directive. */
export function parseCachedReads(file: string, source: string): Record<string, CachedRead> {
  const lines = source.split("\n");
  const reads: Record<string, CachedRead> = {};
  lines.forEach((line, at) => {
    if (!DIRECTIVE.test(line)) return;
    let head = at;
    while (head >= 0 && !FUNCTION_HEAD.test(lines[head])) head--;
    if (head < 0) throw new Error(`${file}:${at + 1}: a "use cache" directive outside a top-level function`);
    let end = at + 1;
    while (end < lines.length && !/^\}/.test(lines[end])) end++;
    const name = FUNCTION_HEAD.exec(lines[head])![1];
    const body = lines.slice(at + 1, end).join("\n");
    const lives = callArgs(body, "cacheLife");
    reads[`${file}#${name}`] = { life: lives.length ? lives.join(" | ") : null, tags: callArgs(body, "cacheTag") };
  });
  return reads;
}

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Each cached read's life and tags as written when the baseline was last written (src/server/use-cache.baseline.json). A changed life or
 * tag fails; a new or removed cached read is only noted, since the others add them in everyday work: rewrite the file with
 * `WRITE_CACHED_READS=1 pnpm exec vitest run src/server/use-cache.scan.test.ts`, whose diff shows each change in review.
 */
const CACHED_READS: Record<string, CachedRead> = JSON.parse(read("src/server/use-cache.baseline.json"));

/** Cached reads with no cacheLife, each following the life of the cached read it calls. Only shrinks. */
const NO_LIFE: Record<string, string> = {
  "src/server/content-grid.ts#ownerSells": "follows the life of the cached read it calls",
  "src/server/campaign-notices.ts#campaignNoticesAt": "follows the life of the cached read it calls",
};

/** Cached reads with no cacheTag. Only shrinks (step 2.15 changes them). */
const NO_TAG: Record<string, string> = {
  "src/server/stores.ts#listCountries": "reference data that changes only with a migration",
  "src/server/brreg.ts#fetchUnit": "another site's data, kept by time",
};

/** The constants from src/server that hold a tag naming no store. */
const PLATFORM_TAGS =
  "STORES_TAG|CATALOG_TAG|AI_TAG|PAGES_TAG|LANGUAGES_TAG|PLANS_TAG|DESIGNS_TAG|STARTERS_TAG|TEMPLATE_TAG|PLATFORM_NAVIGATION_TAG|PLATFORM_SEO_TAG|DOCS_GUIDE_TAG|STATUS_TAG|SIGNUP_TAG|SANDBOX_TAG|SITE_STORE_TAG|REFERRALS_TAG";
const PLATFORM_REFRESH = new RegExp(`\\b(updateTag|revalidateTag|refreshTag|refreshTagNow|staleTag)\\(\\s*(${PLATFORM_TAGS})\\b`);

/** Files of a store's admin that refresh a platform-wide tag today, with the tag. Only shrinks. */
const PLATFORM_TAG_FROM_STORE: Record<string, string> = {
  "src/app/admin/(gated)/[store]/setup/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/countries/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/localization/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/company/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/translate/actions.ts": "STORES_TAG",
};

/** The files under a store's admin that refresh a platform-wide tag, with the tag's name. */
export function platformRefreshes(file: string, source: string): Record<string, string> {
  const m = PLATFORM_REFRESH.exec(source);
  return m ? { [file]: m[2] } : {};
}

const files = ["src/server", "src/app", "src/lib", "src/components"].flatMap(sources).map((p) => relative(ROOT, join(ROOT, p))).sort();
const actual: Record<string, CachedRead> = {};
for (const file of files) Object.assign(actual, parseCachedReads(file, read(file)));
const names = Object.keys(actual).sort();

describe("every cached read says its life and its tags", () => {
  it("finds the cached reads", () => {
    console.log(`cached reads: ${names.length} in ${new Set(names.map((n) => n.split("#")[0])).size} files`);
    expect(names.length).toBeGreaterThan(50);
  });

  it("matches the baseline (a new or removed read is a note)", () => {
    if (process.env.WRITE_CACHED_READS === "1") {
      writeFileSync(join(ROOT, "src/server/use-cache.baseline.json"), `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const added = names.filter((n) => !(n in CACHED_READS));
    const removed = Object.keys(CACHED_READS).filter((n) => !(n in actual));
    if (added.length || removed.length) {
      console.log(`cached reads not in the baseline yet: ${added.join(", ") || "none"}; gone: ${removed.join(", ") || "none"}`);
    }
    const changed = names.filter((n) => n in CACHED_READS && JSON.stringify(actual[n]) !== JSON.stringify(CACHED_READS[n]));
    expect(
      changed.map((n) => `${n}: ${JSON.stringify(CACHED_READS[n])} is now ${JSON.stringify(actual[n])}`),
      "a cached read changed its life or tags: run WRITE_CACHED_READS=1 pnpm exec vitest run src/server/use-cache.scan.test.ts and say why in the commit",
    ).toEqual([]);
  });

  it.each(names)("%s calls cacheLife and cacheTag or is listed", (name) => {
    const { life, tags } = actual[name];
    if (!NO_LIFE[name]) expect(life, `${name} has no cacheLife(): call it, or list it in NO_LIFE with the reason`).not.toBeNull();
    if (!NO_TAG[name]) expect(tags.length, `${name} has no cacheTag(): call it, or list it in NO_TAG with the reason`).toBeGreaterThan(0);
  });

  it("lists only reads that still lack a life or a tag", () => {
    for (const name of Object.keys(NO_LIFE)) {
      expect(names, `${name} is gone: take it off NO_LIFE`).toContain(name);
      expect(actual[name].life, `${name} has a cacheLife() now: take it off NO_LIFE`).toBeNull();
    }
    for (const name of Object.keys(NO_TAG)) {
      expect(names, `${name} is gone: take it off NO_TAG`).toContain(name);
      expect(actual[name].tags, `${name} has a cacheTag() now: take it off NO_TAG`).toEqual([]);
    }
  });
});

describe("a store's admin refreshes no tag that names no store", () => {
  const admin = sources("src/app/admin/(gated)/[store]").map((p) => relative(ROOT, join(ROOT, p))).sort();
  const refreshing = Object.assign({}, ...admin.map((file) => platformRefreshes(file, read(file)))) as Record<string, string>;

  it.each(admin)("%s", (file) => {
    if (PLATFORM_TAG_FROM_STORE[file]) return;
    expect(refreshing[file], `${file} refreshes ${refreshing[file]}, which names no store: refresh a tag with the store in it`).toBeUndefined();
  });

  it("lists only files that still do", () => {
    for (const [file, tag] of Object.entries(PLATFORM_TAG_FROM_STORE)) {
      expect(refreshing[file], `${file} no longer refreshes ${tag}: take it off PLATFORM_TAG_FROM_STORE`).toBe(tag);
    }
  });
});

describe("the parser would notice", () => {
  it("a cached read with a life and no tag", () => {
    const source = [
      "export async function trial(id: string) {",
      '  "use cache";',
      '  cacheLife("hours");',
      "  return id;",
      "}",
      "",
    ].join("\n");
    const reads = parseCachedReads("trial.ts", source);
    expect(reads["trial.ts#trial"]).toEqual({ life: '"hours"', tags: [] });
  });

  it("a cached read with a tag spread over two lines", () => {
    const source = ["async function two() {", '  "use cache: remote";', "  cacheTag(a(1),", "    b);", "  cacheLife({ stale: 3 });", "}", ""].join("\n");
    expect(parseCachedReads("t.ts", source)["t.ts#two"]).toEqual({ life: "{ stale: 3 }", tags: ["a(1), b"] });
  });

  it("a platform-wide refresh in a store admin file", () => {
    expect(platformRefreshes("a.ts", "export async function save() {\n  updateTag(CATALOG_TAG);\n}")).toEqual({ "a.ts": "CATALOG_TAG" });
    expect(platformRefreshes("a.ts", "updateTag(storeTag(slug));")).toEqual({});
  });
});
