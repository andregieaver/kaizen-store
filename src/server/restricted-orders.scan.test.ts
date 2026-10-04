import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A restricted order is used for nothing (D162, `docs/wave-1g-gdpr.md` 2.4 and 3.5 test 6): once a person is erased the sale the bookkeeping duty
 * keeps is cut loose from them (`customer_id` null), but its `email` is still there until the period ends, so every query that matches orders to a
 * person **by email** must leave `restricted_at is null` (and anonymised) in its condition, or the erased person's old orders come back to them, to
 * a customer list, an email or a recommendation. This scan reads the source: a query in `src/server` that reads `commerce.orders` and compares an
 * email must mention `restricted_at` (or the analytics `GONE` fragment), or its file is in the allow-list below with the reason it may not.
 * Matching by `customer_id` needs no guard: a restricted order has none.
 */

const ROOT = join(process.cwd(), "src", "server");

/** Files that may match an order by email without the guard, and why. A new entry needs a reason a reviewer can accept. */
const ALLOWED: Record<string, string> = {
  "withdrawals.ts": "The withdrawal function finds the order by its number and email: the shopper's contract right is not lost by an erasure (docs/wave-1g-gdpr.md 2.7); the one reader allowed.",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|int\.test|scan\.test)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The SQL template strings of a file (backticks), without the nested `${...}` expressions that hold other templates. */
function templates(source: string): string[] {
  return [...source.matchAll(/`((?:\\.|[^`\\])*)`/g)].map((m) => m[1]);
}

const MATCHES_BY_EMAIL = /lower\(\s*(?:o|orders)\.email\s*\)\s*(?:=|in\b|like\b)|lower\(\s*coalesce\([^)]*\bo\.email[^)]*\)\s*\)\s*(?:=|in\b|like\b)|\b(?:o|orders)\.email\s*(?:=|in\b)|from\s+commerce\.orders\s+where[^`]*lower\(\s*email\s*\)\s*(?:=|in\b)/;
const READS_ORDERS = /\bcommerce\.orders\b/;
const GUARDED = /restricted_at|\bGONE\b|anonymised_at/;

describe("a query that matches orders by email leaves out the restricted ones", () => {
  it("has the guard in every such query, or its file in the allow-list with a reason", () => {
    const bare: string[] = [];
    for (const file of sources(ROOT)) {
      const rel = file.slice(ROOT.length + 1);
      if (rel in ALLOWED) continue;
      for (const sql of templates(readFileSync(file, "utf8"))) {
        if (!READS_ORDERS.test(sql) || !MATCHES_BY_EMAIL.test(sql)) continue;
        // An update or a select of the opt-out or code tables may name `o.email` for another alias: only a query that reads orders is looked at.
        if (/from\s+commerce\.email_opt_outs\s+o\b/.test(sql) && !/from\s+commerce\.orders\s+o\b|join\s+commerce\.orders\s+o\b/.test(sql)) continue;
        if (!GUARDED.test(sql)) bare.push(`${rel}: ${sql.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("sees a query that matches orders by email and has no guard (the scan can fail)", () => {
    const bare = "select 1 from commerce.orders o where o.store_id = ${s}::uuid and lower(o.email) = ${email}";
    expect(READS_ORDERS.test(bare) && MATCHES_BY_EMAIL.test(bare) && !GUARDED.test(bare)).toBe(true);
    const guarded = `${bare} and o.restricted_at is null`;
    expect(GUARDED.test(guarded)).toBe(true);
    // Matching by the account needs none; an opt-out's own alias is not an order.
    expect(MATCHES_BY_EMAIL.test("select 1 from commerce.orders o where o.customer_id = ${c}::uuid")).toBe(false);
  });

  it("keeps an allow-list of files that exist and carry a reason", () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(() => statSync(join(ROOT, file)), file).not.toThrow();
      expect(reason.length, file).toBeGreaterThan(30);
    }
  });

  it("guards the readers the spec names: claiming orders, the registration gate, the customer pages, the analytics key and the recommendations", () => {
    const text = (f: string) => readFileSync(join(ROOT, f), "utf8");
    expect(text("customers.ts")).toMatch(/restricted_at is null/);
    expect(text("customer-admin.ts")).toMatch(/restricted_at is null/);
    expect(text("analytics-sql.ts")).toMatch(/restricted_at is not null/);
    expect(text("recommend.ts")).toMatch(/restricted_at is null/);
    expect(text("owner-tools.ts")).toMatch(/restricted_at is null/);
  });
});
