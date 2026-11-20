import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The admin's words stay out of shoppers' functions (bloat review step 0.7). Ceilings only fall. Step 1.8's route-load.graph.test.ts
 * later forbids src/lib/admin-messages to the proxy and the beacons outright.
 *
 * Code outside `src/app/admin` and `src/components/admin` never imports the registry `src/lib/admin-text.ts`, which loaded every area in
 * both languages until bloat review step 2.25 left it types only: it reads its area from `src/lib/admin-words/{stem}.ts`. Each entry that runs for shoppers is walked through its static
 * value imports, and the catalogue files it reaches are counted against its own ceiling.
 */
const SRC = join(process.cwd(), "src");
const REGISTRY = join(SRC, "lib/admin-text.ts");
const MESSAGES = join(SRC, "lib/admin-messages") + "/";
const TABLE = join(SRC, "test/admin-words-all.ts");

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Whether an import brings in only types, which are erased: `import type { A }`, `import { type A }`. */
function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return named !== null && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
}

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (file: string) => relative(process.cwd(), file).replaceAll("\\", "/");

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

/**
 * What `entry` reaches by static value import. A server action file's code is loaded on the server (these entries run there), so
 * unlike the browser walk of `storefront-bundle.scan.test.ts` it is followed. `planted` adds extra imports to a file.
 */
const ownSpecifiers = new Map<string, string[]>();
function specifiersOf(file: string): string[] {
  let found = ownSpecifiers.get(file);
  if (!found) {
    found = [];
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      found.push(match[2] ?? match[3]);
    }
    ownSpecifiers.set(file, found);
  }
  return found;
}

function reach(entry: string, planted: Map<string, string[]> = new Map()): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const specifiers = [...(planted.get(file) ?? []), ...specifiersOf(file)];
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

/** The files outside the admin with a value import of the registry; `planted` adds specifiers to a file's imports. */
function offenders(planted: Map<string, string[]> = new Map()): string[] {
  return files(SRC)
    .filter((file) => {
      const name = rel(file);
      return !name.startsWith("src/app/admin/") && !name.startsWith("src/components/admin/");
    })
    .filter((file) => {
      const specifiers = [...(planted.get(file) ?? [])];
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        if (match[2] === undefined || typesOnly(match[1])) continue;
        specifiers.push(match[2]);
      }
      return specifiers.some((specifier) => resolve(file, specifier) === REGISTRY);
    })
    .map(rel);
}

const catalogues = (seen: Set<string>) => [...seen].filter((file) => file.startsWith(MESSAGES)).length;

/** Catalogue files behind each entry that runs for shoppers; each only falls. */
const CEILINGS: Record<string, number> = {
  "src/proxy.ts": 0,
  "src/app/api/visit/route.ts": 0,
  "src/app/api/visit/touch/route.ts": 0,
  "src/app/api/visit/speed/route.ts": 0,
  "src/app/api/visit/speed/own/route.ts": 0,
  "src/app/api/recommendations/events/route.ts": 0,
  "src/app/s/[store]/[market]/layout.tsx": 8,
};

describe("the admin's words outside the admin (bloat review step 0.7)", () => {
  it("is imported by no file outside the admin: Case A", () => {
    expect(offenders()).toEqual([]);
  });

  it("would notice: a planted import of the registry in the cart", () => {
    const cart = join(process.cwd(), "src/server/cart.ts");
    expect(offenders(new Map([[cart, ["@/lib/admin-text"]]]))).toContain("src/server/cart.ts");
  });

  for (const [entry, ceiling] of Object.entries(CEILINGS)) {
    it(`holds ${entry} to ${ceiling} catalogue files: Case B`, () => {
      const count = catalogues(reach(join(process.cwd(), entry)));
      expect(count, `${entry} reaches more catalogue files than its ceiling`).toBeLessThanOrEqual(ceiling);
      expect(count, `lower CEILINGS[${entry}] to ${count}`).toBeGreaterThanOrEqual(ceiling);
    });

    it(`keeps the registry away from ${entry}: Case C`, () => {
      expect(reach(join(process.cwd(), entry)).has(REGISTRY)).toBe(false);
    });
  }

  // The registry holds types only since bloat review step 2.25; the one table of every area left is the tests' own.
  it("would notice: the tests' table of every area reaches every catalogue: Case D", () => {
    expect(catalogues(reach(TABLE))).toBeGreaterThanOrEqual(130);
  });

  it("would notice: a planted import of the table of every area in a beacon: Case E", () => {
    const entry = join(process.cwd(), "src/app/api/visit/route.ts");
    const planted = catalogues(reach(entry, new Map([[entry, ["@/test/admin-words-all"]]])));
    expect(planted).toBeGreaterThanOrEqual(130);
    expect(planted).toBeGreaterThan(CEILINGS["src/app/api/visit/route.ts"]);
  });
});

/**
 * The admin's own entries (bloat review step 2.25): no module holds a table of every area, and an admin page, layout, route or
 * actions file reaches only the areas its code names, through their modules in `src/lib/admin-words`. Each entry is walked through
 * its static value imports; the areas are the catalogues the area modules it reaches import, and the bytes are those catalogue files,
 * both languages. The figures only fall: lower ADMIN_REACH to a lower walk (67 areas and 3.46 MB at the median on 12 November, 77
 * catalogues and 4.03 MB before this step). The lines of 18 areas and 0.9 MB are step 2.50's.
 */
const WORDS = join(SRC, "lib/admin-words") + "/";
const ADMIN = join(SRC, "app/admin");

/**
 * Recorded on 20 November 2026 (step 2.25's last commit); each may only fall: lower it when the walk finds less. Other changes move them a
 * little (words added to a catalogue, one more area on a page), so a figure fails only past its room: two areas, and 15 % of bytes.
 */
const ADMIN_REACH = {
  medianAreas: 4,
  medianBytes: 213_137,
  largest: { entry: "src/app/admin/(gated)/platform/articles/[pageId]/page.tsx", areas: 24, bytes: 1_736_127 },
  platformHome: { areas: 18, bytes: 1_126_541 },
};
const AREAS_ROOM = 2;
const BYTES_ROOM = 1.15;
/** The step's ceilings for the median entry (67 areas and 3.46 MB before it). */
const MEDIAN_AREAS_MAX = 30;
const MEDIAN_BYTES_MAX = 1_310_000;

const valueImports = (file: string): string[] => {
  const found: string[] = [];
  for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
    if (match[2] !== undefined && typesOnly(match[1])) continue;
    const target = resolve(file, match[2] ?? match[3]);
    if (target) found.push(target);
  }
  return found;
};

const isEntry = (file: string) => /\/(?:page|layout)\.tsx$|\/route\.ts$/.test(file) || /^\s*["']use server["']/m.test(readFileSync(file, "utf8").slice(0, 300));

const sizes = new Map<string, number>();
const areaCatalogues = new Map<string, string[]>();
/** The areas and catalogue bytes an entry reaches through the area modules. */
function wordsReached(entry: string): { areas: number; bytes: number } {
  const catalogueFiles = new Set<string>();
  for (const file of reach(entry)) {
    if (!file.startsWith(WORDS)) continue;
    let own = areaCatalogues.get(file);
    if (!own) {
      own = [...reach(file)].filter((inner) => inner.startsWith(MESSAGES));
      areaCatalogues.set(file, own);
    }
    for (const catalogue of own) catalogueFiles.add(catalogue);
  }
  let bytes = 0;
  for (const catalogue of catalogueFiles) {
    if (!sizes.has(catalogue)) sizes.set(catalogue, statSync(catalogue).size);
    bytes += sizes.get(catalogue)!;
  }
  const areas = new Set([...catalogueFiles].map((catalogue) => catalogue.slice(MESSAGES.length).replace(/\.(?:en|nb)\.ts$/, "")));
  return { areas: areas.size, bytes };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

describe("the admin's words on admin routes (bloat review step 2.25)", () => {
  it("no table of every area: no module value-imports more than 40 area modules, and admin-text.ts holds types only", () => {
    const tables = files(SRC)
      .filter((file) => !rel(file).startsWith("src/test/"))
      .map((file) => ({ file: rel(file), modules: new Set(valueImports(file).filter((target) => target.startsWith(WORDS))).size }))
      .filter(({ modules }) => modules > 40);
    expect(tables).toEqual([]);
    expect(valueImports(REGISTRY)).toEqual([]);
    expect(readFileSync(REGISTRY, "utf8")).not.toMatch(/^import (?!type )/m);
  });

  it("would notice: the tests' table of every area is one", () => {
    expect(new Set(valueImports(TABLE).filter((target) => target.startsWith(WORDS))).size).toBeGreaterThan(40);
  });

  it("what an admin entry reaches: the median at most 30 areas and 1.31 MB, and the recorded figures only fall", { timeout: 120_000 }, () => {
    const rows = files(ADMIN)
      .filter(isEntry)
      .map((entry) => ({ entry: rel(entry), ...wordsReached(entry) }));
    expect(rows.length).toBeGreaterThan(500);
    const areas = median(rows.map((row) => row.areas));
    const bytes = median(rows.map((row) => row.bytes));
    expect(areas).toBeLessThanOrEqual(MEDIAN_AREAS_MAX);
    expect(bytes).toBeLessThanOrEqual(MEDIAN_BYTES_MAX);
    expect(areas, "the median entry's areas rose").toBeLessThanOrEqual(ADMIN_REACH.medianAreas + AREAS_ROOM);
    expect(bytes, "the median entry's catalogue bytes rose").toBeLessThanOrEqual(ADMIN_REACH.medianBytes * BYTES_ROOM);
    const largest = rows.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    expect(largest.bytes, `${largest.entry} reaches ${largest.areas} areas`).toBeLessThanOrEqual(ADMIN_REACH.largest.bytes * BYTES_ROOM);
    expect(largest.areas).toBeLessThanOrEqual(ADMIN_REACH.largest.areas + AREAS_ROOM);
    const home = rows.find((row) => row.entry === "src/app/admin/(gated)/platform/page.tsx")!;
    expect(home.areas).toBeLessThanOrEqual(ADMIN_REACH.platformHome.areas + AREAS_ROOM);
    expect(home.bytes).toBeLessThanOrEqual(ADMIN_REACH.platformHome.bytes * BYTES_ROOM);
  });

  it("would notice: an entry that imports the test table reaches every area", () => {
    const entry = join(process.cwd(), "src/app/admin/(gated)/platform/page.tsx");
    const planted = reach(entry, new Map([[entry, ["@/test/admin-words-all"]]]));
    expect(catalogues(planted)).toBeGreaterThanOrEqual(130);
  });
});
