import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Indexes are declared in two places: `src/db/schema.ts` and hand-written migrations (the hot tables' concurrent builds, and
 * rules Drizzle cannot express). `pnpm db:check` sees only the first; this test reads the catalog after every migration, so it
 * sees both. An index led by another index of its table (the same leading columns, no narrower condition) costs every write one
 * more entry and serves no read the other does not (bloat review step 0.26, DS-9, DS-15).
 */

let db: PGlite;

/** The catalog query: `<partial>` says which kinds of partial index are compared. */
const duplicates = (partial: string) => `
  with ix as (
    select i.indrelid, i.indexrelid, ic.relname as name, i.indisunique as uq, i.indpred is not null as partial,
      (select array_agg(pg_get_indexdef(i.indexrelid, k, true) order by k) from generate_series(1, i.indnkeyatts) k) as cols
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_am am on am.oid = ic.relam
    where ic.relnamespace = 'commerce'::regnamespace and am.amname = 'btree'
  )
  select a.indrelid::regclass::text as tbl, a.name as redundant, b.name as covered_by
  from ix a
  join ix b on b.indrelid = a.indrelid and b.indexrelid <> a.indexrelid
  where not a.uq and ${partial}
    and b.cols[1:cardinality(a.cols)] = a.cols
    and (cardinality(b.cols) > cardinality(a.cols) or b.uq or a.name > b.name)
  order by 1, 2`;

const PLAIN = "not a.partial and not b.partial";

/** Partial indexes led by a whole one, each kept for the reason beside it. */
const ALLOWED: Record<string, string> = {
  ai_usage_autopilot_idx: "a selective condition: few rows match",
  order_events_restock_idx: "a selective condition: few rows match",
  price_lists_exclusive_idx: "a selective condition: few rows match",
  payments_captured_idx: "a selective condition: few rows match",
  orders_list_placed_idx: "another sort order for the orders list",
  orders_list_archived_idx: "another sort order for the orders list",
};

type Row = { tbl: string; redundant: string; covered_by: string };

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("duplicate indexes", () => {
  it("no plain index is led by another", async () => {
    const { rows } = await db.query<Row>(duplicates(PLAIN));
    expect(rows).toEqual([]);
  });

  it("a partial index led by a whole one is on the list, with its reason", async () => {
    const { rows } = await db.query<Row>(duplicates("a.partial and not b.partial"));
    const names = [...new Set(rows.map((row) => row.redundant))].sort();
    // The catalogue has a partial index of this kind only where the list says so; a new one needs a reason written beside its name.
    expect(names.filter((name) => !(name in ALLOWED))).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });

  it("orders has 33 indexes", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from pg_indexes where schemaname = 'commerce' and tablename = 'orders'");
    expect(rows[0]?.n).toBe(33);
  });

  it("would notice", async () => {
    await db.exec("create index scratch_dup_idx on commerce.orders (store_id, placed_at)");
    try {
      const { rows } = await db.query<Row>(duplicates(PLAIN));
      expect(rows.map((row) => row.redundant)).toEqual(["scratch_dup_idx"]);
    } finally {
      await db.exec("drop index commerce.scratch_dup_idx");
    }
  });
});
