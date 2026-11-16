import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server code may render a client component, but it cannot call anything else a `"use client"` file exports: what it receives is a reference,
 * and calling it throws while the page renders ("Attempted to call … from the server"). Round 18 (D657) broke the order page of every pickup
 * order that way: the pickup panel, a server component, called `submitClass()` from `action-form.tsx`. This reads the source: a file without
 * `"use client"` may import from a client file only components (a capitalised name) and types; a function or a constant it needs belongs in a
 * plain module both sides import (`src/lib/submit-class.ts`). Files that are themselves `"use client"`, and tests, are not held to it.
 */
const SRC = join(process.cwd(), "src");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/** `"use client"` as the file's first statement, after comments. */
const isClient = (text: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(text);

/** The file an import names, or null for a package. */
function target(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Value names imported by `import { … } from "…"` (types left out), with the module named. */
function valueImports(text: string): { names: string[]; spec: string }[] {
  const found: { names: string[]; spec: string }[] = [];
  for (const match of text.matchAll(/(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = match[1];
    const braces = clause.match(/\{([\s\S]*)\}/);
    const names = braces
      ? braces[1]
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith("type "))
          .map((part) => part.split(/\s+as\s+/)[0].trim())
      : [];
    found.push({ names, spec: match[2] });
  }
  return found;
}

describe("server code calls nothing but components from a client file", () => {
  const clientCache = new Map<string, boolean>();
  const client = (file: string) => {
    if (!clientCache.has(file)) clientCache.set(file, isClient(readFileSync(file, "utf8")));
    return clientCache.get(file)!;
  };

  it("finds client files to check against, so the scan cannot go stale", () => {
    expect(client(join(SRC, "components/admin/action-form.tsx"))).toBe(true);
    expect(client(join(SRC, "lib/submit-class.ts"))).toBe(false);
  });

  it("imports only components (and types) from a client file into code the server renders", () => {
    // What the server renders: the app's pages, layouts and routes and server code, and every file they import, up to a client file.
    const entries = sources(SRC).filter((file) => {
      const path = relative(SRC, file).replaceAll("\\", "/");
      return /^app\/.*\/(page|layout|route|template|default|not-found|loading)\.tsx?$/.test(path) || /^app\/(page|layout|not-found)\.tsx?$/.test(path) || path.startsWith("server/");
    });
    const seen = new Set<string>();
    const queue = entries.filter((file) => !client(file));
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const { names, spec } of valueImports(text)) {
        const to = target(file, spec);
        if (!to) continue;
        if (client(to)) {
          for (const name of names) {
            if (!/^[A-Z]/.test(name)) offenders.push(`${relative(SRC, file)} calls ${name} from ${relative(SRC, to)}`);
          }
        } else if (!seen.has(to)) {
          queue.push(to);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});
