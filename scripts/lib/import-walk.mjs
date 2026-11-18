// One import walker (bloat review step 1.8): which files a server entry reaches, which packages they import and the largest import cycle.
// Shared by `src/lib/pay-routes.graph.test.ts`, `scripts/lib/route-load.mjs` (so `src/server/route-load.graph.test.ts` and
// `scripts/route-load.mjs`), `src/lib/dependencies.scan.test.ts` and `scripts/route-budget.mjs`. Plain Node, no dependency; no function
// reads process.cwd(), the caller passes the folder. The review's own walker, docs/audits/bloat-review-2026-11/scripts/import-reach.mjs,
// stays as the record of how the review counted.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** `import … from`, `export … from`, `import("…")` (match group 4) and the bare `import "…"` (group 5). */
export const IMPORT =
  /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Whether an import clause brings in only types, which are erased and carry nothing into the bundle: `import type { A }`, `import { type A }`. */
export function typesOnly(clause) {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return (
    named !== null &&
    named[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .every((part) => part.startsWith("type "))
  );
}

/** The modules a file imports as values; with `dynamic` false the `import("…")` form is left out. */
export function importsOf(text, { dynamic = true } = {}) {
  const found = [];
  for (const match of text.matchAll(IMPORT)) {
    if (match[3] !== undefined) {
      if (!typesOnly(match[2])) found.push(match[3]);
    } else if (match[4] !== undefined) {
      if (dynamic) found.push(match[4]);
    } else found.push(match[5]);
  }
  return found;
}

/** `@/x` resolved against `srcDir`, `./x` against the importing file, trying x, x.ts, x.tsx, x/index.ts, x/index.tsx; null for a package. */
export function resolve(srcDir, from, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(srcDir, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.join(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The package name of a bare specifier (`stripe`, `@supabase/supabase-js`); null for `@/` and `.` specifiers and `node:` builtins. */
export function packageOf(specifier) {
  if (specifier.startsWith("@/") || specifier.startsWith(".") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const isClientLeaf = (text) => text.slice(0, 300).includes("use client");

/**
 * @typedef {{ dynamic?: boolean, stop?: (file: string) => boolean, clientLeaf?: boolean, memo?: Map<string, (string | null)[]> }} ReachOptions
 */

/**
 * Every file `entry` reaches by import inside `srcDir`, the entry included: a Map from the file to the file that imported it. `stop`
 * says which files not to follow; with `clientLeaf` a file whose first 300 characters hold a 'use client' directive is recorded but
 * its imports are not followed. `memo` (a Map, optional) keeps what each file resolves to across calls, for a caller that walks many entries.
 * @param {string} srcDir
 * @param {string} entry
 * @param {ReachOptions} [options]
 * @returns {Map<string, string>}
 */
export function reach(srcDir, entry, { dynamic = true, stop = () => false, clientLeaf = false, memo } = /** @type {ReachOptions} */ ({})) {
  const seen = new Map([[entry, ""]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    const key = `${dynamic ? "d" : "s"}${clientLeaf ? "c" : ""}:${file}`;
    let targets = memo?.get(key);
    if (!targets) {
      const text = readFileSync(file, "utf8");
      targets = clientLeaf && isClientLeaf(text) ? [] : importsOf(text, { dynamic }).map((specifier) => resolve(srcDir, file, specifier));
      memo?.set(key, targets);
    }
    for (const target of targets) {
      if (!target || seen.has(target) || stop(target)) continue;
      seen.set(target, file);
      queue.push(target);
    }
  }
  return seen;
}

/**
 * The names of the packages any file that `reach()` returns imports (a client leaf's own imports are not counted when `clientLeaf` is set).
 * @param {string} srcDir
 * @param {string} entry
 * @param {ReachOptions} [options]
 * @returns {Set<string>}
 */
export function packagesReached(srcDir, entry, options = {}) {
  const packages = new Set();
  for (const file of reach(srcDir, entry, options).keys()) {
    const text = readFileSync(file, "utf8");
    if (options.clientLeaf && isClientLeaf(text)) continue;
    for (const specifier of importsOf(text, { dynamic: options.dynamic ?? true })) {
      const name = packageOf(specifier);
      if (name) packages.add(name);
    }
  }
  return packages;
}

/** Every .ts and .tsx file under `dir` that is not a *.test.* file. */
export function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) sourceFiles(file, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(file);
  }
  return found;
}

/** Tarjan's strongly connected components over `files`; `{ size, files }` of the largest (size 1: no cycle). */
export function largestCycle(srcDir, files, { dynamic = false } = {}) {
  const inSet = new Set(files);
  const edges = new Map(
    files.map((file) => [
      file,
      importsOf(readFileSync(file, "utf8"), { dynamic })
        .map((specifier) => resolve(srcDir, file, specifier))
        .filter((target) => target && inSet.has(target)),
    ]),
  );
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  let best = { size: files.length > 0 ? 1 : 0, files: files.slice(0, 1) };
  for (const start of files) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const top = work[work.length - 1];
      const [node, at] = top;
      const next = edges.get(node);
      if (at < next.length) {
        top[1]++;
        const to = next[at];
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push([to, 0]);
        } else if (onStack.has(to)) low.set(node, Math.min(low.get(node), index.get(to)));
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === index.get(node)) {
          const component = [];
          let member;
          do {
            member = stack.pop();
            onStack.delete(member);
            component.push(member);
          } while (member !== node);
          if (component.length > best.size) best = { size: component.length, files: component };
        }
      }
    }
  }
  return best;
}
