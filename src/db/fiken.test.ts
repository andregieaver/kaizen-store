import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_PERSONAL } from "@/lib/personal-data";
import { COPY_RULES, SECRET_TABLES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * Fiken (D460): the rules the database holds for a connection and for what was sent, run against real Postgres (PGlite) with every
 * migration applied. One company belongs to one store; a connection names its company once chosen and is started before it sends; a booked
 * row keeps Fiken's id; a sale is never sent without its number, and one number is booked once; both tables are private, never copied, and
 * hold no person's data.
 */

let db: PGlite;
let shop: string;
let other: string;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('fk-shop', 'Fiken', 'NO') returning id")).id;
  other = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('fk-other', 'Other', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

describe("a Fiken connection", () => {
  it("chooses its company before it is set up, and is started before it sends", async () => {
    await db.query("insert into commerce.fiken_connections (store_id, access_token_encrypted) values ($1, 'v2.x')", [shop]);
    await rejects("update commerce.fiken_connections set state = 'setup' where store_id = $1", [shop], /fiken_connections_company/);
    await db.query("update commerce.fiken_connections set state = 'setup', company_slug = 'human-web-as', company_name = 'Human Web AS' where store_id = $1", [shop]);
    await rejects("update commerce.fiken_connections set state = 'on' where store_id = $1", [shop], /fiken_connections_started/);
    await db.query("update commerce.fiken_connections set state = 'on', sync_from = '2026-11-05' where store_id = $1", [shop]);
  });

  it("belongs to one store per Fiken company", async () => {
    await db.query("insert into commerce.fiken_connections (store_id, access_token_encrypted) values ($1, 'v2.y')", [other]);
    await rejects("update commerce.fiken_connections set state = 'setup', company_slug = 'human-web-as', company_name = 'X' where store_id = $1", [other], /fiken_connections_company_key/);
    await db.query("delete from commerce.fiken_connections where store_id = $1", [other]);
  });

  it("takes only its states and an object of settings", async () => {
    await rejects("update commerce.fiken_connections set state = 'broken' where store_id = $1", [shop], /fiken_connections_state/);
    await rejects("update commerce.fiken_connections set settings = '[]' where store_id = $1", [shop], /fiken_connections_settings/);
  });
});

const sync = (kind: string, localId: string, cols = "", values: unknown[] = []) =>
  db.query(
    `insert into commerce.fiken_sync (store_id, company_slug, kind, local_id${cols ? `, ${cols}` : ""})
     values ($1, 'human-web-as', $2, $3${values.map((_, i) => `, $${i + 4}`).join("")})`,
    [shop, kind, localId, ...values],
  );

describe("what was sent to Fiken", () => {
  it("is one row per object and company", async () => {
    await sync("work_invoice", "00000000-0000-4000-8000-000000000001");
    await expect(sync("work_invoice", "00000000-0000-4000-8000-000000000001")).rejects.toThrow(/fiken_sync_store_id_company_slug_kind_local_id_pk/);
    await sync("customer", "shop");
  });

  it("never claims to be booked without Fiken's id, nor sends a sale without its number", async () => {
    await rejects("update commerce.fiken_sync set state = 'synced' where kind = 'customer'", [], /fiken_sync_synced/);
    await rejects("update commerce.fiken_sync set state = 'sending' where kind = 'work_invoice'", [], /fiken_sync_sale_number/);
    await db.query("update commerce.fiken_sync set state = 'sending', external_key = 'W-1' where kind = 'work_invoice'");
    await db.query("update commerce.fiken_sync set state = 'synced', their_id = 5001, their_ref = '18' where kind = 'work_invoice'");
  });

  it("books one sale number once per company", async () => {
    await expect(sync("work_credit_note", "00000000-0000-4000-8000-000000000002", "external_key", ["W-1"])).rejects.toThrow(/fiken_sync_external_key/);
  });

  it("takes only its kinds and states, and short texts", async () => {
    await rejects("update commerce.fiken_sync set kind = 'order' where kind = 'customer'", [], /fiken_sync_kind/);
    await rejects("update commerce.fiken_sync set state = 'lost' where kind = 'customer'", [], /fiken_sync_state/);
    await rejects("update commerce.fiken_sync set error_detail = repeat('x', 401) where kind = 'customer'", [], /fiken_sync_texts/);
    await rejects("update commerce.fiken_sync set posting = 0 where kind = 'customer'", [], /fiken_sync_attempts/);
  });
});

describe("the Fiken tables", () => {
  it("are private to the server", async () => {
    for (const table of ["fiken_connections", "fiken_sync"]) {
      const row = await one<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = $1", [table]);
      expect(row.relrowsecurity, table).toBe(true);
    }
  });

  it("are never copied with a store, hold no person's data, and stay out of the store's file", () => {
    expect(COPY_RULES.fiken_connections.group).toBe("never");
    expect(COPY_RULES.fiken_sync.group).toBe("never");
    expect(SECRET_TABLES).toContain("fiken_connections");
    expect(NOT_PERSONAL.fiken_connections).toBeTruthy();
    expect(NOT_PERSONAL.fiken_sync).toBeTruthy();
    expect(STORE_EXPORT_LEFT_OUT.fiken_connections).toBe("secret");
  });
});
