import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * The import walk of `src/lib/storefront-bundle.scan.test.ts` as a helper for the scans of the admin (bloat review step 1.4): the
 * admin's client modules, the catalogue files, the words outside the admin. It is a copy with options; the storefront test keeps its
 * own. A static walk does not follow `import()`: a part loaded on a press may be large.
 */
export const SRC = join(process.cwd(), "src");
export const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** The packages the walks name instead of walking into. */
export const PACKAGES = ["zod", "@supabase", "@tiptap"];

/** Whether an import brings in only types, which are erased: `import type { A }`, `import { type A }`. */
export function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return named !== null && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
}

/** A package name for `zod`, `@supabase/...` and `@tiptap/...`; else the file a `@/` or relative specifier names, or null. */
export function resolve(from: string, specifier: string): string | null {
  if (specifier === "zod" || specifier.startsWith("zod/")) return "zod";
  if (specifier.startsWith("@supabase/")) return "@supabase";
  if (specifier.startsWith("@tiptap/")) return "@tiptap";
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The package name, or the path relative to `src` with forward slashes and its extension. */
export const rel = (file: string) => (PACKAGES.includes(file) ? file : relative(SRC, file).replaceAll("\\", "/"));

/** Whether the first 300 characters carry the directive, `"use client"` or `"use server"`. */
export const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["']`, "m").test(text.slice(0, 300));

const texts = new Map<string, string>();
/** A file's text, kept so hundreds of walks read each file once. */
export function read(file: string): string {
  let text = texts.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    texts.set(file, text);
  }
  return text;
}

/** Every .ts and .tsx file under `dir` that is not a test. */
export function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

export type WalkOptions = {
  /** Do not walk into a file that imports `server-only` (default true). */
  stopAtServerOnly?: boolean;
  /** Do not walk into a file with a `"use server"` directive, unless it is the entry (default true). */
  stopAtUseServer?: boolean;
  /** Extra specifiers treated as imports of a file, for the cases that show a scan would notice. */
  planted?: Map<string, string[]>;
};

/** The value imports of a file: its text's imports but the types, and anything planted on it. */
export function specifiersOf(file: string, planted?: Map<string, string[]>): string[] {
  const specifiers = [...(planted?.get(file) ?? [])];
  for (const match of read(file).matchAll(IMPORT)) {
    if (match[2] !== undefined && typesOnly(match[1])) continue;
    specifiers.push(match[2] ?? match[3]);
  }
  return specifiers;
}

/** What `entry` reaches by static value import, each with the file that brought it in (the entry maps to ""). */
export function reach(entry: string, options: WalkOptions = {}): Map<string, string> {
  const { stopAtServerOnly = true, stopAtUseServer = true, planted } = options;
  const seen = new Map<string, string>([[entry, ""]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (PACKAGES.includes(file)) continue;
    const text = read(file);
    if (file !== entry && stopAtUseServer && directive(text, "use server")) continue;
    const specifiers = specifiersOf(file, planted);
    if (file !== entry && stopAtServerOnly && specifiers.includes("server-only")) continue;
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (!target || seen.has(target)) continue;
      seen.set(target, file);
      queue.push(target);
    }
  }
  return seen;
}

/** The names from the entry to `target`, as `rel()` writes them. */
export function chain(seen: Map<string, string>, target: string): string[] {
  const names = [rel(target)];
  for (let at = seen.get(target); at; at = seen.get(at)) names.unshift(rel(at));
  return names;
}
