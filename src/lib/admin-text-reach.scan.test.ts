import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The admin's words stay out of shoppers' functions (bloat review step 0.7). Ceilings only fall. Step 1.8's route-load.graph.test.ts
 * later forbids src/lib/admin-messages to the proxy and the beacons outright.
 *
 * Code outside `src/app/admin` and `src/components/admin` never imports the registry `src/lib/admin-text.ts`, which loads every area in
 * both languages: it reads its area from `src/lib/admin-words/{stem}.ts`. Each entry that runs for shoppers is walked through its static
 * value imports, and the catalogue files it reaches are counted against its own ceiling.
 */
const SRC = join(process.cwd(), "src");
const REGISTRY = join(SRC, "lib/admin-text.ts");
const MESSAGES = join(SRC, "lib/admin-messages") + "/";

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
function reach(entry: string, planted: Map<string, string[]> = new Map()): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const specifiers = [...(planted.get(file) ?? [])];
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      specifiers.push(match[2] ?? match[3]);
    }
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

const catalogues = (seen: Set<string>) => [...seen].filter((file) => file.startsWith(MESSAGES)).length;

/** Catalogue files behind each entry that runs for shoppers; each only falls. */
const CEILINGS: Record<string, number> = {
  "src/proxy.ts": 9,
  "src/app/api/visit/route.ts": 2,
  "src/app/api/visit/touch/route.ts": 2,
  "src/app/api/visit/speed/route.ts": 2,
  "src/app/api/visit/speed/own/route.ts": 2,
  "src/app/api/recommendations/events/route.ts": 1,
  "src/app/s/[store]/[market]/layout.tsx": 13,
};

describe("the admin's words outside the admin (bloat review step 0.7)", () => {
  it("is imported by no file outside the admin: Case A", () => {
    const found = files(SRC)
      .filter((file) => {
        const name = rel(file);
        return !name.startsWith("src/app/admin/") && !name.startsWith("src/components/admin/");
      })
      .filter((file) => {
        for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
          if (match[2] === undefined || typesOnly(match[1])) continue;
          if (resolve(file, match[2]) === REGISTRY) return true;
        }
        return false;
      })
      .map(rel);
    expect(found).toEqual([]);
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

  it("would notice: the registry itself reaches every catalogue: Case D", () => {
    expect(catalogues(reach(REGISTRY))).toBeGreaterThanOrEqual(130);
  });

  it("would notice: a planted import of the registry in a beacon: Case E", () => {
    const entry = join(process.cwd(), "src/app/api/visit/route.ts");
    const planted = catalogues(reach(entry, new Map([[entry, ["@/lib/admin-text"]]])));
    expect(planted).toBeGreaterThanOrEqual(130);
    expect(planted).toBeGreaterThan(CEILINGS["src/app/api/visit/route.ts"]);
  });
});
