import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_LANGS, type AdminLang } from "@/lib/admin-lang";
import type { AdminArea } from "@/lib/admin-text";
import { ALL_AREA_WORDS } from "@/test/admin-words-all";

import baseline from "./admin-words-handed.baseline.json";

/**
 * Every place the admin hands words to the browser (bloat review step 1.28, `docs/performance.md`, `docs/rules/budgets.md`). A site is
 * one `areaTexts(lang, { area: AREA_WORDS })` call (bloat review step 2.25; a list of area names before it) or one
 * `<AdminAreas areas={...}>`; its id is the file and the areas (`views.tsx#website+schedules`, or the constant's name). Per site and
 * language the test counts the bytes handed (the areas' catalogues as JSON) and the bytes named:
 * the groups the client parts under the site read, found in source by static import (`useAdminText("area").group`, a destructuring, or
 * the variable's later uses; anything else takes the whole area). Named is counted from source, not what a browser reads at load: the
 * browser record of step 1.5 (`e2e/signed-in/admin-scripts.spec.ts`) is the cross-check on five screens, and step 2.27 works the list down.
 * Rewrite the baseline with `WRITE_ADMIN_WORDS_BASELINE=1 pnpm exec vitest run src/components/admin/admin-words-handed.scan.test.ts`;
 * the writer only lowers a site's bytes and shortens its `unnamed` list.
 */
const WRITE = process.env.WRITE_ADMIN_WORDS_BASELINE === "1";
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const LAZY = /^src\/components\/admin\/lazy\//;
const LAZY_IMPORT = /import\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

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

const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["']`, "m").test(text.slice(0, 300));

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

const texts = new Map<string, string>();
function read(file: string): string {
  let text = texts.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    texts.set(file, text);
  }
  return text;
}

const imports = new Map<string, string[]>();
function importsOf(file: string): string[] {
  let found = imports.get(file);
  if (!found) {
    found = [];
    for (const match of read(file).matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      const target = resolve(file, match[2] ?? match[3]);
      if (target) found.push(target);
    }
    // A stand-in of the admin's lazy modules (`components/admin/lazy/`, `next/dynamic`) is drawn under the site that imports it, so the part its
    // `import()` loads reads the site's words too (bloat review step 2.30).
    if (LAZY.test(repo(file))) {
      for (const match of read(file).matchAll(LAZY_IMPORT)) {
        const target = resolve(file, match[1]);
        if (target) found.push(target);
      }
    }
    imports.set(file, found);
  }
  return found;
}

const reached = new Map<string, Set<string>>();
function reach(file: string): Set<string> {
  let seen = reached.get(file);
  if (!seen) {
    seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
      for (const target of importsOf(queue.pop()!)) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    reached.set(file, seen);
  }
  return seen;
}

const SKIP = ["src/lib/admin-text.ts", "src/components/admin/admin-areas.tsx", "src/components/admin/admin-text.tsx", "src/components/admin/admin-text-context.tsx"];
const repo = (file: string) => relative(ROOT, file).replaceAll("\\", "/");

const ALL = files(SRC);
const SITE_FILES = ALL.filter((file) => {
  const name = repo(file);
  return (name.startsWith("src/app/admin/") || name.startsWith("src/components/admin/")) && !SKIP.includes(name);
});

/**
 * The strings of `const NAME = [ ... ]`, or the keys of `const NAME = { area: AREA_WORDS, ... }`, in this file or the file NAME is
 * imported from; a spread of another constant is resolved too.
 */
function constantAreas(name: string, file: string, depth = 0): string[] | null {
  if (depth > 4) return null;
  const own = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(read(file));
  if (own) return listAreas(own[1], file, depth);
  const object = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\}`).exec(read(file));
  if (object) return objectAreas(object[1], file, depth);
  for (const match of read(file).matchAll(IMPORT)) {
    if (match[2] === undefined || !new RegExp(`\\b${name}\\b`).test(match[1])) continue;
    const target = resolve(file, match[2]);
    if (target) return constantAreas(name, target, depth + 1);
  }
  return null;
}

function listAreas(body: string, file: string, depth = 0): string[] | null {
  const found: string[] = [];
  for (const part of body.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const literal = /^["']([A-Za-z]+)["']$/.exec(part);
    const spread = /^\.\.\.([A-Z_]+)$/.exec(part);
    if (literal) found.push(literal[1]);
    else if (spread) {
      const inner = constantAreas(spread[1], file, depth + 1);
      if (!inner) return null;
      found.push(...inner);
    } else return null;
  }
  return found;
}

/** The keys of `{ area: AREA_WORDS, ...OTHER }`, the modules an `areaTexts()` call or `<AdminAreas>` hands (bloat review step 2.25). */
function objectAreas(body: string, file: string, depth = 0): string[] | null {
  const found: string[] = [];
  for (const part of body.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const entry = /^([A-Za-z]+)\s*:\s*[A-Z][A-Z_]*_WORDS$/.exec(part);
    const spread = /^\.\.\.([A-Z_]+)$/.exec(part);
    if (entry) found.push(entry[1]);
    else if (spread) {
      const inner = constantAreas(spread[1], file, depth + 1);
      if (!inner) return null;
      found.push(...inner);
    } else return null;
  }
  return found;
}

type Site = { id: string; file: string; areas: string[] };

function findSites(): { sites: Site[]; unresolved: string[] } {
  const sites: Site[] = [];
  const unresolved: string[] = [];
  for (const file of SITE_FILES) {
    const text = read(file);
    const found: { index: number; list: string }[] = [];
    for (const match of text.matchAll(/areaTexts\(\s*([^,]+),\s*(\{[^}]*\}|[A-Z_]+)\s*\)/g)) found.push({ index: match.index!, list: match[2] });
    for (const match of text.matchAll(/<AdminAreas\s+areas=\{(\[[^\]]*\]|\{[^}]*\}|[A-Z_]+)\}/g)) found.push({ index: match.index!, list: match[1] });
    // A call the patterns do not match is named, not skipped.
    const calls = [...text.matchAll(/(?<![.\w])areaTexts\(/g)].filter((m) => !/^\s*(?:export\s+)?(?:async\s+)?function/.test(text.slice(Math.max(0, m.index! - 40), m.index!).split("\n").pop() ?? ""));
    const matched = found.filter((entry) => /^areaTexts\(/.test(text.slice(entry.index, entry.index + 12))).length;
    if (calls.length > matched) unresolved.push(`${repo(file)}: ${calls.length - matched} areaTexts() call(s) the patterns do not match`);
    const used = new Map<string, number>();
    for (const { list } of found.sort((a, b) => a.index - b.index)) {
      const constant = /^[A-Z_]+$/.test(list);
      const areas = constant ? constantAreas(list, file) : list.startsWith("{") ? objectAreas(list.slice(1, -1), file) : listAreas(list.slice(1, -1), file);
      if (!areas) {
        unresolved.push(`${repo(file)}: ${list}`);
        continue;
      }
      const key = constant ? list : areas.join("+");
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      sites.push({ id: `${repo(file)}#${key}${count > 1 ? `#${count}` : ""}`, file, areas });
    }
  }
  return { sites, unresolved };
}

const PARTS = /^(page|layout|default|loading|error|not-found)\.tsx$/;
function folderFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) folderFiles(path, found);
    else if (PARTS.test(name)) found.push(path);
  }
  return found;
}

const unders = new Map<string, string[]>();
/** The client files a site's words can reach by static import (a layout also covers the pages below its folder). */
function under(file: string): string[] {
  let found = unders.get(file);
  if (!found) {
    const roots = /(^|\/)layout\.tsx$/.test(repo(file)) ? [file, ...folderFiles(dirname(file))] : [file];
    const all = new Set<string>();
    for (const root of roots) for (const target of reach(root)) all.add(target);
    found = [...all].filter((target) => directive(read(target), "use client")).sort();
    unders.set(file, found);
  }
  return found;
}

/** The groups one client file names of an area, or "whole". */
function namedBy(text: string, area: string): Set<string> | "whole" | null {
  const hook = new RegExp(`use(?:Admin|Handed)Text\\(\\s*["']${area}["']\\s*\\)`, "g");
  const names = new Set<string>();
  let any = false;
  for (const match of text.matchAll(hook)) {
    any = true;
    const before = text.slice(0, match.index!);
    const after = text.slice(match.index! + match[0].length);
    const direct = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(after);
    if (direct) {
      names.add(direct[1]);
      continue;
    }
    const destructured = /(?:const|let)\s*\{([^}]*)\}\s*(?::[^=]+)?=\s*$/.exec(before);
    if (destructured) {
      for (const part of destructured[1].split(",").map((piece) => piece.trim()).filter(Boolean)) {
        if (part.startsWith("...")) return "whole";
        names.add(/^([A-Za-z_$][\w$]*)/.exec(part)?.[1] ?? "");
      }
      continue;
    }
    const variable = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(before);
    if (!variable) return "whole";
    const V = variable[1].replace(/\$/g, "\\$");
    for (const use of after.matchAll(new RegExp(`(?<![\\w$.])${V}(?![\\w$])`, "g"))) {
      const next = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(after.slice(use.index! + use[0].length));
      if (/^\s*:/.test(after.slice(use.index! + use[0].length)) && /[{,]\s*$/.test(after.slice(0, use.index!))) continue;
      if (next) names.add(next[1]);
      else return "whole";
    }
  }
  return any ? names : null;
}

type Figures = { areas: string[]; handed: Record<AdminLang, number>; named: Record<AdminLang, number>; whole: string[]; unnamed: string[] };

const size = (value: unknown) => (value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value)));

function figures(file: string, areas: string[]): Figures {
  const parts = under(file);
  const whole: string[] = [];
  const unnamed: string[] = [];
  const groups = new Map<string, Set<string>>();
  for (const area of areas) {
    const set = new Set<string>();
    let seen = false;
    let all = false;
    for (const part of parts) {
      const got = namedBy(read(part), area);
      if (got === null) continue;
      seen = true;
      if (got === "whole") all = true;
      else for (const name of got) set.add(name);
    }
    if (!seen) unnamed.push(area);
    else if (all) whole.push(area);
    groups.set(area, set);
  }
  const handed = {} as Record<AdminLang, number>;
  const named = {} as Record<AdminLang, number>;
  for (const lang of ADMIN_LANGS) {
    handed[lang] = 0;
    named[lang] = 0;
    for (const area of areas) {
      const words = ALL_AREA_WORDS[area as AdminArea][lang] as unknown as Record<string, unknown>;
      handed[lang] += size(words);
      if (whole.includes(area)) named[lang] += size(words);
      else for (const group of groups.get(area) ?? []) named[lang] += size(words[group]);
    }
  }
  return { areas, handed, named, whole, unnamed };
}

const { sites, unresolved } = findSites();
type Entry = Figures;
const BASE = baseline.sites as Record<string, Entry>;
const now = new Map<string, Figures>();
if (!WRITE || true) for (const site of sites) now.set(site.id, figures(site.file, site.areas));

describe.runIf(WRITE)("the baseline writer", () => {
  it("writes the baseline", () => {
    const out: Record<string, Figures> = {};
    for (const id of [...now.keys()].sort()) {
      const fresh = now.get(id)!;
      const old = BASE[id];
      // Today's figures, growth included: a rewrite is the deliberate step that accepts it, and the baseline's diff shows it. An area
      // nothing names that is newly handed is never written in: that one is always a fault to fix.
      out[id] = old ? { ...fresh, unnamed: fresh.unnamed.filter((area) => old.unnamed.includes(area)) } : fresh;
    }
    writeFileSync(join(SRC, "components/admin/admin-words-handed.baseline.json"), JSON.stringify({ sites: out }, null, 2) + "\n");
  });
});

describe.skipIf(WRITE)("the admin's hand-down sites", () => {
  const REWRITE = "run WRITE_ADMIN_WORDS_BASELINE=1 pnpm exec vitest run src/components/admin/admin-words-handed.scan.test.ts and commit the baseline";
  /** A new site may hand this much English before it must hand a cut. */
  const NEW_SITE_MAX = 50_000;
  /** What a site may grow before it fails: words added to an area are normal, a whole area added is not (2,000 bytes or a tenth). */
  const growthAllowed = (base: number) => Math.max(2_000, Math.round(base * 0.1));

  it("resolves every site's areas", () => {
    expect(unresolved).toEqual([]);
  });

  // A new site passes until the baseline is next rewritten, unless it hands much at once or an area nothing under it reads: the test
  // holds what grows, without failing every new page the admin gains (17 November 2026, after the first day on a moving main).
  it("a new hand-down site hands little, and only what its parts read", () => {
    expect(sites.length).toBeGreaterThanOrEqual(188);
    const big = [...now].filter(([id, fresh]) => !(id in BASE) && (fresh.handed.en > NEW_SITE_MAX || fresh.unnamed.length > 0));
    expect(
      big.map(([id, fresh]) => `${id} is new and hands ${fresh.handed.en} bytes of en words${fresh.unnamed.length ? `, with ${fresh.unnamed.join(", ")} that nothing under it reads` : ""}: hand only the groups its parts name`),
    ).toEqual([]);
  });

  it("no site hands more than its baseline", () => {
    const over: string[] = [];
    for (const [id, fresh] of now) {
      const old = BASE[id];
      if (!old) continue;
      for (const lang of ADMIN_LANGS) {
        if (fresh.handed[lang] > old.handed[lang] + growthAllowed(old.handed[lang])) {
          over.push(`${id} hands ${fresh.handed[lang]} bytes of ${lang} words, ${old.handed[lang]} in the baseline: hand a cut of the area (only the groups the parts name), or move the part's words to an area of its own; if the part needs them all, rewrite the baseline (${REWRITE}) so the growth shows in its diff`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it("no site hands an area nothing names", () => {
    const found: string[] = [];
    for (const [id, fresh] of now) {
      const old = BASE[id];
      if (!old) continue;
      for (const area of fresh.unnamed) {
        if (!old.unnamed.includes(area)) found.push(`${id} hands "${area}" and no client part under it reads it: take it out of the hand-down`);
      }
    }
    expect(found).toEqual([]);
  });

  it("the baseline is as low as the code", () => {
    const stale: string[] = [];
    for (const [id, fresh] of now) {
      const old = BASE[id];
      if (!old) continue;
      for (const lang of ADMIN_LANGS) if (fresh.handed[lang] < old.handed[lang] - growthAllowed(old.handed[lang])) stale.push(`${id} (${lang}): ${old.handed[lang]} -> ${fresh.handed[lang]}`);
      for (const area of old.unnamed) if (!fresh.unnamed.includes(area)) stale.push(`${id}: "${area}" is named or no longer handed`);
    }
    expect(stale, REWRITE).toEqual([]);
  });

  it("would notice: one more area on the pages list's hand-down", () => {
    const first = sites.find((site) => site.file.endsWith("[store]/pages/views.tsx"))!;
    expect(first).toBeDefined();
    const extra = first.areas.includes("schedules") ? "capacity" : "schedules";
    const planted = figures(first.file, [...first.areas, extra]);
    const old = BASE[first.id];
    expect(planted.handed.en).toBeGreaterThan(old.handed.en + 200);
    if (!under(first.file).some((part) => namedBy(read(part), extra) !== null)) expect(planted.unnamed).toContain(extra);
  });
});
