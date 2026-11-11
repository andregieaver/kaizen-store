import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runsOutsideTransaction } from "../../scripts/lib/migrations.mjs";

/**
 * Migrations that leave the busiest tables writable (code review step 1.6, finding FD4). A plain `create index` holds a lock that blocks
 * every insert and update on its table until the index is built, and `add constraint … foreign key` or `check` reads the whole table
 * under a lock as strong: milliseconds while the tables are small, a checkout that stalls once they are not. So a new migration builds
 * an index on one of these tables `concurrently`, in a file whose first line is `-- kaizen:no-transaction` (Postgres refuses a
 * concurrent build inside a transaction; `scripts/db-migrate.mjs` runs such a file statement by statement), and adds a constraint
 * `not valid`, then checks it with `validate constraint` (which lets writes through) in a later file, or later in a marked one, so the
 * strong lock of the first is let go before the long read of the second. A table the same file creates is empty: anything
 * goes there. `docs/ci-migrations.md` has the rule.
 */

/** The tables a checkout, a visit or the catalogue writes to all day. */
export const HOT_TABLES = ["orders", "order_lines", "visits", "products", "product_variants", "customers", "carts", "cart_lines"];

/** Files up to this one were written before the rule; they are applied everywhere and never run again. */
const BEFORE_THE_RULE = "20261111172838_sms_campaign_index.sql";

const table = (name: string) => `(?:only\\s+)?(?:"?commerce"?\\.)?"?${name}"?(?=[\\s(;]|$)`;

/** Each statement of a migration's text that would block writes on a hot table, as one line. */
export function blockingStatements(text: string): string[] {
  const statements = text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const found: string[] = [];
  for (const name of HOT_TABLES) {
    if (new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${table(name)}`, "i").test(text)) continue;
    const plainIndex = new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?!concurrently\\b)[^;]*?\\bon\\s+${table(name)}`, "i");
    const constraint = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?${table(name)}.*\\badd\\s+constraint\\b.*\\b(?:foreign\\s+key|check)\\b`, "i");
    for (const statement of statements) {
      if (plainIndex.test(statement)) found.push(`${statement} (build it concurrently, in a file marked -- kaizen:no-transaction)`);
      else if (constraint.test(statement) && !/\bnot\s+valid\b/i.test(statement)) found.push(`${statement} (add it not valid, then validate constraint)`);
    }
  }
  return found;
}

const dir = path.join(process.cwd(), "supabase", "migrations");
const newer = readdirSync(dir)
  .filter((file) => file.endsWith(".sql") && file > BEFORE_THE_RULE)
  .sort();

describe("migrations keep the busiest tables writable (code review FD4)", () => {
  it("adds no index or constraint on a hot table that blocks its writes while it is built", () => {
    const found = newer.flatMap((file) => blockingStatements(readFileSync(path.join(dir, file), "utf8")).map((line) => `${file}: ${line}`));
    expect(found).toEqual([]);
  });

  it("builds concurrently only in a file marked to run outside a transaction, where Postgres allows it", () => {
    const unmarked = newer.filter((file) => {
      const text = readFileSync(path.join(dir, file), "utf8");
      return /\bindex\s+concurrently\b/i.test(text) && !runsOutsideTransaction(text);
    });
    expect(unmarked).toEqual([]);
  });

  it("validates every constraint it adds not valid, in a later statement that commits on its own", () => {
    const texts = newer.map((file) => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));
    const unchecked = texts.flatMap(({ file, text }) =>
      [...text.matchAll(/add\s+constraint\s+"?([a-z0-9_]+)"?[^;]*\bnot\s+valid\b/gi)]
        .map((match) => match[1])
        .filter((name) => !texts.some((other) => (other.file > file || (other.file === file && runsOutsideTransaction(other.text))) && new RegExp(`validate\\s+constraint\\s+"?${name}"?`, "i").test(other.text)))
        .map((name) => `${file}: ${name}`),
    );
    expect(unchecked).toEqual([]);
  });

  it("catches what it says it catches", () => {
    expect(blockingStatements('CREATE INDEX "orders_x_idx" ON "commerce"."orders" USING btree ("store_id","x");')).toHaveLength(1);
    expect(blockingStatements("create unique index cart_lines_key on commerce.cart_lines (cart_id, variant_id);")).toHaveLength(1);
    expect(blockingStatements('ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_x_fk" FOREIGN KEY ("x") REFERENCES "commerce"."xs"("id");')).toHaveLength(1);
    expect(blockingStatements("alter table commerce.products add constraint products_x_check check (x > 0);")).toHaveLength(1);
    // The safe forms, another table, and a hot table's name inside a longer one, pass.
    expect(blockingStatements("create index concurrently if not exists orders_x_idx on commerce.orders (x);")).toEqual([]);
    expect(blockingStatements("alter table commerce.orders add constraint orders_x_fk foreign key (x) references commerce.xs (id) not valid;")).toEqual([]);
    expect(blockingStatements("alter table commerce.orders validate constraint orders_x_fk;")).toEqual([]);
    expect(blockingStatements('CREATE INDEX "sms_idx" ON "commerce"."sms_messages" ("store_id");')).toEqual([]);
    expect(blockingStatements('CREATE INDEX "x_idx" ON "commerce"."orders_archive" ("store_id");')).toEqual([]);
    expect(blockingStatements("-- create index x on commerce.orders (y);")).toEqual([]);
    // A table the file makes is empty.
    expect(blockingStatements('CREATE TABLE "commerce"."carts" (id uuid);\nCREATE INDEX "carts_x" ON "commerce"."carts" ("id");')).toEqual([]);
    expect(runsOutsideTransaction("-- kaizen:no-transaction\ncreate index concurrently x on commerce.orders (y);")).toBe(true);
    expect(runsOutsideTransaction("create index x on commerce.orders (y);\n-- kaizen:no-transaction")).toBe(false);
  });
});
