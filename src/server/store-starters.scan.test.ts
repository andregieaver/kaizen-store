import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Store templates (D175, `docs/store-templates.md` section 2) are real stores marked `starter`, and like the default template they are not
 * real businesses: everything that counts, lists, bills, scans or acts on stores leaves them out. Read from the source:
 * - nothing says "not the template" alone (`not s.is_template`): the condition is `not (s.is_template or s.starter)`;
 * - every module reading `is_template` (or a store's `isTemplate`) is listed here with what it means, so a new reader forces a decision:
 *   `real` (not a real store: starters are left out too) or `template` (THE default template, which starters are not).
 * Tests are exempt; migrations are SQL and not read here.
 */
const ROOT = process.cwd();

const READERS: Record<string, "real" | "template" | "both"> = {
  "src/app/admin/(gated)/[store]/settings/seo/page.tsx": "real",
  "src/app/s/[store]/(chooser)/layout.tsx": "real",
  "src/app/s/[store]/[market]/layout.tsx": "real",
  "src/db/health.ts": "template",
  "src/db/schema.ts": "both",
  "src/server/ai-usage.ts": "real",
  "src/server/auth.ts": "real",
  "src/server/billing.ts": "both",
  "src/server/content-grid.ts": "real",
  "src/server/cookie-scans.ts": "real",
  "src/server/experiments.ts": "real",
  "src/server/manager-tools.ts": "real",
  "src/server/plan-reminders.ts": "template",
  "src/server/platform-customers.ts": "real",
  "src/server/platform-overview.ts": "real",
  "src/server/platform-unit-tests.ts": "real",
  "src/server/platform.ts": "real",
  "src/server/referrals.ts": "real",
  "src/server/seo.ts": "real",
  "src/server/store-closure.ts": "template",
  "src/server/store-copy.ts": "real",
  "src/server/stores.ts": "both",
  "src/server/vat-admin.ts": "real",
  "src/server/wordpress.ts": "real",
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = sources(path.join(ROOT, "src"));
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("store templates are not real stores (D175)", () => {
  it("finds the modules", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("never says 'not the template' without the starter", () => {
    const bare = files.filter((f) => /\bnot\s+(\w+\.)?is_template\b/i.test(code(f))).map((f) => path.relative(ROOT, f));
    expect(bare).toEqual([]);
  });

  it("lists every reader of is_template with what it means", () => {
    const readers = files
      .filter((f) => /\bis_template\b|\.isTemplate\b/.test(code(f)))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(readers).toEqual(Object.keys(READERS).sort());
  });

  it("leaves starters out wherever a reader means 'a real store'", () => {
    const missing = Object.entries(READERS)
      .filter(([, meaning]) => meaning === "real" || meaning === "both")
      .filter(([file]) => !/\bstarter\b/.test(code(path.join(ROOT, file))))
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });

  it("copies a new store only from the source the database decides", () => {
    const copiers = files.filter((f) => /commerce\.clone_store\(/.test(code(f))).map((f) => path.relative(ROOT, f)).sort();
    expect(copiers).toEqual(["src/server/platform.ts", "src/server/store-starters.ts"]);
    for (const file of copiers) {
      const calls = code(path.join(ROOT, file)).match(/commerce\.clone_store\(\s*[^,]+/g) ?? [];
      for (const call of calls) expect(call, file).toMatch(/commerce\.starter_source\(/);
    }
  });
});
