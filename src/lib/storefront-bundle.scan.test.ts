import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the visitor's browser loads (D211, `docs/performance.md`): every client component a visitor's page can draw is walked through
 * its static imports, and none may reach zod, the page model (`lib/page-content`) or the interface text of every language (D212). zod with its translations is 90 KB of the
 * first scripts, and a schema built in the browser checks nothing the server does not check again. A module that has both
 * plain helpers and schemas keeps its schemas in `*-schema.ts` beside it; a view the browser needs only now and then is loaded
 * with `import()` (the recommended grid's), which this walk does not follow.
 *
 * Left out: the admin, and the staff's text editing on the live site (`components/inline-edit`), which is loaded only when a
 * signed-in person turns it on. A server action file (`"use server"`) is a reference in the browser, not its code.
 */
const SRC = join(process.cwd(), "src");
const FORBIDDEN = ["zod", "lib/page-content", "lib/i18n", "lib/email-text"];

/**
 * The interface text (D212): all four hand-written languages are 270 KB, so a visitor's browser loads only its page's, through
 * `LanguageTexts`, whose module for a language is the one place that may import it. Everything else reads `browserText()`.
 */
function forbidden(entry: string, target: string): boolean {
  const name = rel(target);
  if (FORBIDDEN.includes(name)) return true;
  const language = /^lib\/messages\/(\w+)$/.exec(name)?.[1];
  return language !== undefined && rel(entry) !== `components/language-texts/${language}`;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Whether an import brings in only types, which are erased: `import type { A }`, `import { type A }`. */
function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return named !== null && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
}

function resolve(from: string, specifier: string): string | null {
  if (specifier === "zod" || specifier.startsWith("zod/")) return "zod";
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (file: string) => (file === "zod" ? "zod" : relative(SRC, file).replaceAll("\\", "/").replace(/\.tsx?$/, ""));
const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["']`, "m").test(text.slice(0, 300));

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

/** The visitor's client components: every `"use client"` file but the admin's and the staff's editing. */
const ENTRIES = files(SRC).filter((file) => {
  const name = rel(file);
  if (name.startsWith("components/admin/") || name.startsWith("app/admin/") || name.startsWith("components/inline-edit/")) return false;
  return directive(readFileSync(file, "utf8"), "use client");
});

/** What `entry` reaches by static import, each with the file that brought it in. */
function reach(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, ""]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (file === "zod") continue;
    const text = readFileSync(file, "utf8");
    if (file !== entry && directive(text, "use server")) continue;
    for (const match of text.matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      const target = resolve(file, match[2] ?? match[3]);
      if (!target || seen.has(target)) continue;
      seen.set(target, file);
      queue.push(target);
    }
  }
  return seen;
}

describe("the visitor's scripts", () => {
  it("finds the client components to walk", () => {
    const names = ENTRIES.map(rel);
    for (const name of ["components/carousel", "components/consent/consent-manager", "components/site-form", "components/gallery-lightbox"]) expect(names).toContain(name);
    expect(names.some((name) => name.startsWith("components/admin/"))).toBe(false);
  });

  it("never reach zod, the page model or every language's interface text", () => {
    const found: string[] = [];
    for (const entry of ENTRIES) {
      const seen = reach(entry);
      for (const target of seen.keys()) {
        if (!forbidden(entry, target)) continue;
        const chain = [rel(target)];
        for (let at = seen.get(target); at; at = seen.get(at)) chain.unshift(rel(at));
        found.push(chain.join(" -> "));
      }
    }
    expect(found).toEqual([]);
  });

  it("would notice: a language's module is reached only from its own loader", () => {
    const loader = join(SRC, "components/language-texts/nb.tsx");
    const reached = [...reach(loader).keys()];
    expect(reached.map(rel)).toContain("lib/messages/nb");
    expect(reached.some((target) => forbidden(loader, target))).toBe(false);
    expect(reached.some((target) => forbidden(join(SRC, "components/language-texts/sv.tsx"), target))).toBe(true);
  });

  it("would notice: the product editor (admin) reaches zod", () => {
    const form = join(SRC, "components/admin/product-editor.tsx");
    expect([...reach(form).keys()].map(rel)).toContain("zod");
  });
});
