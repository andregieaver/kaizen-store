import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importsOf, largestCycle, packageOf, reach } from "../../scripts/lib/import-walk.mjs";
import {
  BEACONS,
  ENTRIES,
  FORBIDDEN,
  HEAVY,
  PROXY_FILES_MAX,
  READER_FORBIDDEN,
  USE_SERVER_LINE,
  adminStoreLayoutCachedFiles,
  chainTo,
  readerFiles,
  routeLoadCounts,
  walkOf,
} from "../../scripts/lib/route-load.mjs";
import baseline from "./route-load.baseline.json";

/**
 * What a server entry loads (bloat review step 1.8, SG-14, SF-7, AS-3): the files each of 18 entries (the proxy, the start hook, health,
 * the five beacons, the store's layout and pages, the admin's layouts and two pages, the site's front page, the docs' feedback) reaches
 * by static value imports (`import()` is not followed: it is how a heavy module is kept off a route), the largest import cycle in
 * src/server, and the modules and packages an entry may not reach, as `route-load.baseline.json` records them. An entry's files have room
 * of max(5, 3 %) for everyday work; a new forbidden module or a larger cycle fails at once. A fall is a note: `node scripts/route-load.mjs
 * --write` lowers the baseline, so the next change cannot spend the room.
 */
const root = process.cwd();
const now = routeLoadCounts(root) as {
  largestCycle: number;
  entries: Record<string, number>;
  exceptions: Record<string, string[]>;
  handlers: Record<string, number>;
  adminStoreLayoutCachedFiles: number;
};
const recorded = baseline as {
  largestCycle: number;
  entries: Record<string, number>;
  exceptions: Record<string, string[]>;
  heavyHandlers: Record<string, { files: number; reason: string }>;
  adminStoreLayoutCachedFiles: number;
};
const names = Object.keys(ENTRIES as Record<string, string>);
/** Everyday work adds a file or two to a large entry; a module that drags in a tree adds dozens. Room: max(5 files, 3 %). */
const roomFor = (held: number) => Math.max(5, Math.ceil(held * 0.03));

/** A line that is exactly a directive that makes server references: "use cache" (or one with a suffix such as ": remote") or "use server". */
const REFERENCE_DIRECTIVE = /^\s*["'](?:use cache(?:: [a-z]+)?|use server)["'];?\s*$/m;
const relOf = (file: string) => path.relative(root, file).split(path.sep).join("/");

/** The files an entry's walk reaches whose text has a "use cache" or "use server" line, each with the chain of imports to it. */
function referenceFiles(name: string): string[] {
  const seen = walkOf(root, name) as Map<string, string>;
  return [...seen.keys()].filter((file) => REFERENCE_DIRECTIVE.test(readFileSync(file, "utf8"))).map((file) => `${relOf(file)} (${chainTo(root, seen, file)})`);
}

/** The first file the walk reached that matches a forbidden item (a file, a folder ending in `/`, or a package), with the chain to it. */
function whyReached(name: string, item: string): string {
  const seen = walkOf(root, name) as Map<string, string>;
  const isPackage = !item.startsWith("src/");
  const file = [...seen.keys()].find((f) => {
    if (isPackage) return (importsOf(readFileSync(f, "utf8"), { dynamic: false }) as string[]).some((specifier) => packageOf(specifier) === item);
    const rel = path.relative(root, f).split(path.sep).join("/");
    return item.endsWith("/") ? rel.startsWith(item) : rel === item;
  });
  return file ? `${chainTo(root, seen, file)}${isPackage ? ` imports ${item}` : ""}` : `${item} is imported through a file the walk reaches`;
}

describe("what a server entry loads (bloat review 1.8)", () => {
  it("no entry reaches more files", () => {
    const raised = names
      .filter((name) => now.entries[name] > (recorded.entries[name] ?? 0) + roomFor(recorded.entries[name] ?? 0))
      .map(
        (name) =>
          `${name}: reaches ${now.entries[name]} files, baseline ${recorded.entries[name] ?? 0} with room ${roomFor(recorded.entries[name] ?? 0)}. Import the helper from the file that defines it, or load the module with import() where it is used; a rise on purpose is written with node scripts/route-load.mjs --first and shows in the diff.`,
      );
    expect(raised).toEqual([]);
  });

  it(`the proxy reaches at most ${PROXY_FILES_MAX} files: it imports leaf readers only (bloat review step 2.20)`, () => {
    console.info(`route-load: the proxy reaches ${now.entries.proxy} files (at most ${PROXY_FILES_MAX})`);
    expect(
      now.entries.proxy,
      "src/proxy.ts imports a reader that reaches the server's heavy modules: a reader imports the database client, typed-rows, the log, the short memory and pure src/lib code, never its feature's writers",
    ).toBeLessThanOrEqual(PROXY_FILES_MAX);
  });

  it("the page reader reaches at most 130 files (bloat review step 2.21)", () => {
    console.info(`route-load: src/server/page-reads.ts reaches ${now.entries["page-reads"]} files (at most 130)`);
    expect(
      now.entries["page-reads"],
      `src/server/page-reads.ts reaches ${now.entries["page-reads"]} files: the reader may import only the database client, the tag leaf (src/lib/cache-tags.ts), the page model and the media library's alt texts (src/server/media-alts.ts)`,
    ).toBeLessThanOrEqual(130);
  });

  it("the largest import cycle in src/server does not grow", () => {
    expect(now.largestCycle, "the largest import cycle in src/server: import the helper from the file that defines it").toBeLessThanOrEqual(recorded.largestCycle);
  });

  it("no entry reaches a forbidden module", () => {
    const found = names.flatMap((name) =>
      now.exceptions[name]
        .filter((item) => !(recorded.exceptions[name] ?? []).includes(item))
        .map((item) => `${name} reaches ${item}: ${whyReached(name, item)}. Load it with import() where it is used, or import the helper from the file that defines it.`),
    );
    expect(found).toEqual([]);
  });

  it(`every handler over ${HEAVY.toLocaleString("en")} files is on the named list with a reason`, () => {
    const missing = Object.keys(now.handlers).filter((file) => !recorded.heavyHandlers[file]);
    expect(missing, `a route.ts over ${HEAVY} files needs an entry and a reason in heavyHandlers of src/server/route-load.baseline.json`).toEqual([]);
    const noReason = Object.entries(recorded.heavyHandlers)
      .filter(([, h]) => !h.reason.trim() || h.reason.trim() === "TODO")
      .map(([file]) => file);
    expect(noReason).toEqual([]);
  });

  it("notes what fell: node scripts/route-load.mjs --write lowers the baseline", () => {
    const stale = [
      ...(now.largestCycle < recorded.largestCycle ? [`largest import cycle: ${now.largestCycle}, baseline ${recorded.largestCycle}`] : []),
      ...names.filter((name) => now.entries[name] < recorded.entries[name]).map((name) => `${name}: ${now.entries[name]} files, baseline ${recorded.entries[name]}`),
      ...names.flatMap((name) =>
        (recorded.exceptions[name] ?? []).filter((item) => !now.exceptions[name].includes(item)).map((item) => `${name}: ${item} is no longer reached`),
      ),
      ...Object.entries(recorded.heavyHandlers)
        .filter(([file]) => !((now.handlers as Record<string, number>)[file] > HEAVY))
        .map(([file]) => `${file} is at ${HEAVY} files or under`),
    ];
    if (stale.length > 0) console.info(`route-load: fell, lower it with node scripts/route-load.mjs --write: ${stale.join("; ")}`);
    expect(Array.isArray(stale)).toBe(true);
  });

  it("a reader file reaches no action file, and not auth, audit or pages (bloat review step 2.24)", () => {
    const posixRel = (file: string) => path.relative(root, file).split(path.sep).join("/");
    const found = (readerFiles(root) as string[]).flatMap((file) => {
      const seen = reach(path.join(root, "src"), path.join(root, file), { dynamic: false, clientLeaf: true }) as Map<string, string>;
      return [...seen.keys()]
        .filter((reached) => (READER_FORBIDDEN as string[]).includes(posixRel(reached)) || (USE_SERVER_LINE as RegExp).test(readFileSync(reached, "utf8")))
        .map((reached) => `${file} reaches ${posixRel(reached)}: ${chainTo(root, seen, reached)}`);
    });
    expect(
      found,
      "a reader file (src/server/*-read.ts, page-reads.ts) holds a feature's cached reads apart from its writers: it imports the database client, typed-rows, the log, the tag leaf, pure src/lib code and other reader files",
    ).toEqual([]);
  });

  it("the admin's store layout reaches no more files with 'use cache' than its stored number (bloat review step 2.24)", () => {
    const files = adminStoreLayoutCachedFiles(root) as string[];
    console.info(`route-load: the admin's store layout reaches ${files.length} files with "use cache" (baseline ${recorded.adminStoreLayoutCachedFiles})`);
    expect(
      files.length,
      `every cached read the store layout reaches is listed by each of the admin's store routes in the server-reference manifest: import the reader file (x-read.ts) or the tag leaf, not the feature. Reached: ${files.join(", ")}`,
    ).toBeLessThanOrEqual(recorded.adminStoreLayoutCachedFiles);
  });

  it("the walker would notice", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "route-load-"));
    try {
      const a = path.join(dir, "a.ts");
      const b = path.join(dir, "b.ts");
      const c = path.join(dir, "c.ts");
      mkdirSync(dir, { recursive: true });
      writeFileSync(a, 'import { b } from "./b";\nexport const a = b;\n');
      writeFileSync(b, 'import type { c } from "./c";\nexport const b = 1;\nexport type B = typeof c;\n');
      writeFileSync(c, 'import { a } from "./a";\nexport const c = a;\n');
      expect(reach(dir, a, { dynamic: false }).size).toBe(2);
      expect(largestCycle(dir, [a, b, c], { dynamic: false }).size).toBe(1);
      writeFileSync(b, 'import { c } from "./c";\nexport const b = c;\n');
      expect(reach(dir, a, { dynamic: false }).size).toBe(3);
      expect(largestCycle(dir, [a, b, c], { dynamic: false }).size).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the five beacons reach no 'use cache' and no 'use server' file (bloat review step 2.24)", () => {
    const found = (BEACONS as string[]).flatMap((name) => referenceFiles(name).map((file) => `${name} reaches ${file}`));
    expect(
      found,
      "every cached read and action a beacon reaches is listed for it in the server-reference manifest, which each cold function parses: import a tag from @/lib/cache-tags, a pure helper from its leaf file, and read the store with visitStoreOf() (src/server/store-facts.ts)",
    ).toEqual([]);
  });

  it("the proxy and the beacons reach no admin catalogue", () => {
    const forbidden = FORBIDDEN as Record<string, string[]>;
    for (const name of ["proxy", ...(BEACONS as string[])]) expect(forbidden[name], name).toContain("src/lib/admin-messages/");
    const found = ["proxy", ...(BEACONS as string[])].filter(
      (name) => now.exceptions[name].includes("src/lib/admin-messages/") && !(recorded.exceptions[name] ?? []).includes("src/lib/admin-messages/"),
    );
    expect(found, "these reach src/lib/admin-messages/").toEqual([]);
  });
});
