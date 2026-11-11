import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `sql.raw()` puts text into a query as it is, unbound (PSI SEC follow-up): every use is listed here with how many it has and where its
 * text comes from. Each takes only text written in the code: a fixed list of words, a column, table or alias named in the code, a
 * number, or a value the tool's schema already held to an enum or an integer. Never a person's input. A new use, or one more in a listed
 * file, fails this test: bind the value with `${value}` instead, or, when it must be raw (a column's or table's name, an interval's unit,
 * an alias), say here where its text comes from.
 */
const RAW_USES: Record<string, { uses: number; from: string }> = {
  "src/app/admin/(gated)/platform/themes/[presetId]/workspace-actions.ts": { uses: 1, from: "header_id, footer_id or product_layout_id, chosen in code by kind" },
  "src/db/client.ts": { uses: 1, from: "longerTimeout(): a whole number of seconds the code clamps to 1 to 55" },
  "src/db/schema.ts": { uses: 13, from: "check constraints built from the code's own constant lists and numbers" },
  "src/server/activity.ts": { uses: 1, from: "readableAreas(): the code's area keys" },
  "src/server/after-sale.ts": { uses: 1, from: "the code's list of ended statuses" },
  "src/server/analytics-discounts-data.ts": { uses: 2, from: "column expressions written in the code" },
  "src/server/analytics-returns-data.ts": { uses: 1, from: "a table alias written in the code" },
  "src/server/analytics-traffic-data.ts": { uses: 3, from: "column names k0, k1… from an index" },
  "src/server/campaigns.ts": { uses: 2, from: "the column expression c.id, written in the code" },
  "src/server/content-packs.ts": { uses: 2, from: "header_menu_id or footer_menu_id from a fixed list" },
  "src/server/custom-fields.ts": { uses: 2, from: "draft or published, and the tables products, pages or terms, typed as those words" },
  "src/server/customer-admin.ts": { uses: 2, from: "a table alias written in the code" },
  "src/server/design-presets.ts": { uses: 5, from: "p.draft or p.published, and header_id, footer_id or product_layout_id chosen in code" },
  "src/server/domain-holder.ts": { uses: 1, from: "a table alias and column names written in the code" },
  "src/server/domain-purchases.ts": { uses: 1, from: "stripe_customer_live or stripe_customer_test, chosen in code by mode" },
  "src/server/legal-starters.ts": { uses: 1, from: "LEGAL_ROLES, the code's list" },
  "src/server/limits.ts": { uses: 1, from: "ON_PLAN_STATUSES, the code's list" },
  "src/server/live-drills.ts": { uses: 1, from: "an order alias written in the code" },
  "src/server/owner-insights.ts": { uses: 3, from: "an interval of the tool's period (an enum) and count (an integer), both held by its schema" },
  "src/server/payment-mode-sql.ts": { uses: 1, from: "the payments row's alias, written by each caller" },
  "src/server/pipedrive.ts": { uses: 1, from: "TABLES, the code's map of a link's kind to its table" },
  "src/server/plan-reminders.ts": { uses: 1, from: "ON_PLAN_STATUSES, the code's list" },
  "src/server/platform-customers.ts": { uses: 1, from: "ON_PLAN_STATUSES, the code's list" },
  "src/server/preview-links.ts": { uses: 2, from: "a table alias written in the code" },
  "src/server/privacy-export.ts": { uses: 4, from: "a variant alias written in the code" },
  "src/server/producer-registrations.ts": { uses: 1, from: "SCHEME_IDS, the code's list" },
  "src/server/products.ts": { uses: 1, from: "a record type written in the code" },
  "src/server/report-query.ts": { uses: 22, from: "the report catalogue's dimensions and measures, written in the code; names d0, d1… from an index" },
  "src/server/seo.ts": { uses: 1, from: "LEGAL_ROLES, the code's list" },
  "src/server/site-layouts.ts": { uses: 4, from: "header_id or footer_id, chosen in code" },
  "src/server/store-copy-media.ts": { uses: 2, from: "table and column names from the code's list of copied tables" },
  "src/server/store-export.ts": { uses: 1, from: "STORE_EXPORT_TABLES, the code's list" },
  "src/server/store-roles.ts": { uses: 5, from: "the code's role templates and permissions, and a role's permissions after isGrantable() kept only the code's keys" },
  "src/server/store-translate.ts": { uses: 3, from: "LEGAL_ROLES and column names written in the code" },
  "src/server/taxonomy.ts": { uses: 1, from: "a column list written in the code" },
  "src/server/term-rules.ts": { uses: 1, from: "column names c0, c1… from an index" },
  "src/server/theme-shots.ts": { uses: 1, from: "an expression written in the code" },
  "src/server/wishlists.ts": { uses: 3, from: "a table alias written in the code" },
  "src/server/work-reports.ts": { uses: 1, from: "a column name written in the code" },
};

const root = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe("sql.raw() is used only where the code says where its text comes from", () => {
  const found = Object.fromEntries(
    walk(path.join(root, "src"))
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file))
      .map((file) => [path.relative(root, file).split(path.sep).join("/"), (readFileSync(file, "utf8").match(/\bsql\.raw\(/g) ?? []).length] as const)
      .filter(([, uses]) => uses > 0),
  );

  it("has every use listed, with its count, and nothing listed that is gone", () => {
    const listed = Object.fromEntries(Object.entries(RAW_USES).map(([file, { uses }]) => [file, uses]));
    expect(found).toEqual(listed);
  });

  it("says for each where the text comes from", () => {
    for (const [file, { from }] of Object.entries(RAW_USES)) expect(from.length, file).toBeGreaterThan(10);
  });
});
