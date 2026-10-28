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
  "src/app/api/feeds/[token]/[file]/route.ts": "real",
  "src/app/admin/(gated)/[store]/settings/seo/page.tsx": "real",
  "src/app/s/[store]/(chooser)/layout.tsx": "real",
  "src/app/s/[store]/[market]/layout.tsx": "real",
  "src/db/health.ts": "template",
  "src/db/schema.ts": "both",
  // The agents' safety eval plays its cases on the template store (PSI 2026-10-24, AST-09).
  "src/server/agent-eval.ts": "template",
  "src/server/ai-usage.ts": "real",
  // An Admin API token (D355) answers for a real store only.
  "src/server/api-tokens.ts": "real",
  "src/server/auth.ts": "real",
  // An account's own erasure (D377): only a real store needs the account as its last owner.
  "src/server/account-erasure.ts": "real",
  "src/server/billing.ts": "both",
  // Broadcasts (D297): a template or demo store sends no marketing email.
  "src/server/broadcasts.ts": "real",
  "src/server/automations.ts": "real",
  "src/server/autopilot-goals.ts": "real",
  "src/server/stock-requests.ts": "real",
  "src/server/review-import.ts": "real",
  "src/server/review-requests.ts": "real",
  "src/server/review-picture-store.ts": "real",
  "src/server/reviews.ts": "real",
  "src/server/content-grid.ts": "real",
  // Domains (D315): a template or a store template never buys one, and is never opened for buying.
  "src/server/domain-purchases.ts": "real",
  "src/server/domain-admin.ts": "real",
  "src/server/domain-account.ts": "real",
  // Design profiles (D176): the Standard store a preview is drawn on, and the default template named among the stores a snapshot is taken from.
  "src/server/design-presets.ts": "template",
  "src/server/cookie-scans.ts": "real",
  "src/server/experiments.ts": "real",
  // Usage and limits (D314): templates and demo stores are never limited, and only real stores count towards an owner's stores.
  "src/server/limits.ts": "real",
  "src/server/usage-alerts.ts": "real",
  "src/server/usage.ts": "real",
  "src/server/manager-tools.ts": "real",
  "src/server/plan-reminders.ts": "template",
  "src/server/platform-customers.ts": "real",
  "src/server/platform-overview.ts": "real",
  "src/server/platform-unit-tests.ts": "real",
  "src/server/platform.ts": "real",
  // Private mode (D339): a template or demo store is never private.
  "src/server/private-mode.ts": "real",
  "src/server/redirect-resolve.ts": "real",
  "src/app/admin/(gated)/[store]/settings/private/page.tsx": "real",
  "src/server/referrals.ts": "real",
  "src/server/seo.ts": "real",
  "src/server/setup-tools.ts": "real",
  // Shopping agents (D353): a template or demo store never serves agents.
  "src/server/shopping-agent-settings.ts": "real",
  "src/server/shopping-agents.ts": "real",
  "src/app/s/[store]/agents.md/route.ts": "real",
  "src/server/legal-writer.ts": "real",
  "src/server/page-looks.ts": "real",
  "src/server/store-closure.ts": "template",
  "src/server/store-copy.ts": "real",
  "src/server/storefront-api.ts": "real",
  "src/server/stores.ts": "both",
  "src/server/support-platform.ts": "real",
  // Premium themes (D286): only a real store keeps a theme it had as given when the theme gets its first price.
  "src/server/theme-prices.ts": "real",
  // Themes from outside (D344): only a real store's look is shared, and only real stores count as using a theme.
  "src/server/theme-submissions.ts": "real",
  "src/server/theme-store.ts": "real",
  "src/app/admin/(gated)/[store]/settings/design/page.tsx": "real",
  "src/app/admin/(gated)/[store]/settings/design/share/page.tsx": "real",
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

describe("demo stores are not real stores (D175)", () => {
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
    // design-presets.ts makes a design profile's workspace (D177) from the default template, `starter_source(null)`; demo-stores.ts makes a
    // demo store (D277) from published starting content; a store template's frozen copy is made in SQL (`commerce.freeze_starter()`), never here.
    expect(copiers).toEqual(["src/server/demo-stores.ts", "src/server/design-presets.ts", "src/server/platform.ts", "src/server/store-starters.ts"]);
    for (const file of copiers) {
      const calls = code(path.join(ROOT, file)).match(/commerce\.clone_store\(\s*[^,]+/g) ?? [];
      for (const call of calls) expect(call, file).toMatch(/commerce\.starter_source\(/);
    }
  });
});
