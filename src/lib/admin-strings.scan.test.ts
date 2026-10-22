import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The admin's words come from its catalogues (D312, `docs/platform-admin-i18n.md` 3.3): `adminText(lang, area)` on the server and
 * `useAdminText(area)` in the browser, never words written into a component. The admin is converted area by area (A1 to A11), so this
 * holds what is there: each file's English, counted, may only fall. `admin-strings.baseline.json` is how much each file had when the
 * scan began; a file with more than it, or a new file with any, fails; one with less asks for the baseline to be written again, so it only
 * ever shrinks. Names that are the same in every language (Kaizena Flow, a person's or a product's name typed as data) are allowed.
 *
 * `UPDATE_ADMIN_STRINGS=1 pnpm exec vitest run src/lib/admin-strings.scan.test.ts` writes the baseline (only ever after a conversion).
 */

const ROOT = process.cwd();
const BASELINE = join(ROOT, "src/lib/admin-strings.baseline.json");
const DIRS = ["src/app/admin", "src/components/admin"];

/** Words the same in every language. */
const NAMES = new Set(["Kaizena Flow", "Kaizen Life", "Stripe", "Mollie", "Google", "Slack", "WordPress", "Shopify", "CSV", "PDF", "SKU", "URL"]);

const JSX_TEXT = />\s*([^<>{}]*[A-Za-z]{2,}[^<>{}]*?)\s*</g;
const READ_PROPS = /\b(label|title|description|placeholder|alt|aria-label|legend|hint)=\s*"([^"]+)"/g;

/** The English a file writes into its markup: words between tags and in the props a person reads. */
export function englishIn(source: string): string[] {
  const found: string[] = [];
  for (const re of [JSX_TEXT, READ_PROPS]) {
    for (const match of source.matchAll(re)) {
      const words = (match[2] ?? match[1]).trim();
      if (!/[A-Za-z]{2,}/.test(words) || NAMES.has(words)) continue;
      // Code between tags (a generic, an arrow, a comparison), not words.
      if (/[=;()]|=>|&&|\|\|/.test(words)) continue;
      found.push(words);
    }
  }
  return found;
}

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const path = join(abs, name);
    if (statSync(path).isDirectory()) return files(relative(ROOT, path));
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [relative(ROOT, path)] : [];
  });
}

function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of DIRS.flatMap(files).sort()) {
    const n = englishIn(readFileSync(join(ROOT, file), "utf8")).length;
    if (n > 0) out[file] = n;
  }
  return out;
}

describe("the admin's words (D312)", () => {
  const now = counts();
  if (process.env.UPDATE_ADMIN_STRINGS === "1") writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
  const baseline: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};

  it("writes no more English into a file than it had: new words go in the catalogues", () => {
    const grown = Object.entries(now)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => {
        const words = englishIn(readFileSync(join(ROOT, file), "utf8"));
        return `${file}: ${n} (was ${baseline[file] ?? 0}): ${words.slice(0, 8).join(" | ")}`;
      });
    expect(grown).toEqual([]);
  });

  it("keeps the baseline as small as the admin is: a converted file is written down", () => {
    const shrunk = Object.entries(baseline)
      .filter(([file, n]) => (now[file] ?? 0) < n)
      .map(([file, n]) => `${file}: ${now[file] ?? 0} (was ${n})`);
    expect(shrunk, "run UPDATE_ADMIN_STRINGS=1 pnpm exec vitest run src/lib/admin-strings.scan.test.ts").toEqual([]);
  });

  it("catches words written into a component, and lets names and code pass", () => {
    expect(englishIn('<p className="x">Save the page</p>')).toEqual(["Save the page"]);
    expect(englishIn('<Field label="Store name" />')).toEqual(["Store name"]);
    expect(englishIn("<h2>Kaizena Flow</h2><b>{w.title}</b><T extends A = B>")).toEqual([]);
  });
});
