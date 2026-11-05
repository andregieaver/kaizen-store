import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_PERSONAL } from "@/lib/personal-data";
import { COPY_RULES, SECRET_TABLES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * Tripletex (D453): the rules the database holds for a connection and for what was sent, run against real Postgres (PGlite)
 * with every migration applied. One company belongs to one store; a connection is started before it sends; a booked row
 * keeps its Tripletex id; a voucher is never sent without its external number, and one number is booked once; both tables
 * are private, never copied, and hold no person's data.
 */

let db: PGlite;
let shop: string;
let other: string;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('tx-shop', 'Tripletex', 'NO') returning id")).id;
  other = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('tx-other', 'Other', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

const connect = (storeId: string, companyId: number, extra = "", values: unknown[] = []) =>
  db.query(
    `insert into commerce.tripletex_connections (store_id, mode, token_kind, token_encrypted, token_hint, company_id, company_name${extra ? `, ${extra}` : ""})
     values ($1, 'test', 'api_token', 'v2.00000000.x.y.z', 'tlxr_…abcd', $2, 'Human Web AS'${values.map((_, i) => `, $${i + 3}`).join("")})`,
    [storeId, companyId, ...values],
  );

describe("a Tripletex connection", () => {
  it("is set up before it sends: a started connection has its first date", async () => {
    await connect(shop, 101);
    await rejects("update commerce.tripletex_connections set state = 'on' where store_id = $1", [shop], /tripletex_connections_started/);
    await db.query("update commerce.tripletex_connections set state = 'on', sync_from = '2026-11-05' where store_id = $1", [shop]);
    expect((await one<{ state: string }>("select state from commerce.tripletex_connections where store_id = $1", [shop])).state).toBe("on");
  });

  it("belongs to one store per Tripletex company, in each environment", async () => {
    await expect(connect(other, 101)).rejects.toThrow(/tripletex_connections_company_key/);
    await connect(other, 102);
    await db.query("delete from commerce.tripletex_connections where store_id = $1", [other]);
  });

  it("takes only the two environments, the two kinds of token and its states", async () => {
    await rejects("update commerce.tripletex_connections set mode = 'staging' where store_id = $1", [shop], /tripletex_connections_mode/);
    await rejects("update commerce.tripletex_connections set token_kind = 'password' where store_id = $1", [shop], /tripletex_connections_token_kind/);
    await rejects("update commerce.tripletex_connections set state = 'broken' where store_id = $1", [shop], /tripletex_connections_state/);
    await rejects("update commerce.tripletex_connections set settings = '[]' where store_id = $1", [shop], /tripletex_connections_settings/);
  });
});

const sync = (kind: string, localId: string, cols = "", values: unknown[] = []) =>
  db.query(
    `insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id${cols ? `, ${cols}` : ""})
     values ($1, 'test', 101, $2, $3${values.map((_, i) => `, $${i + 4}`).join("")})`,
    [shop, kind, localId, ...values],
  );

describe("what was sent to Tripletex", () => {
  it("is one row per object and company", async () => {
    await sync("work_invoice", "00000000-0000-4000-8000-000000000001");
    await expect(sync("work_invoice", "00000000-0000-4000-8000-000000000001")).rejects.toThrow(/tripletex_sync_store_id_mode_company_id_kind_local_id_pk/);
    await sync("customer", "shop");
  });

  it("never claims to be booked without Tripletex's id, nor sends a voucher without its external number", async () => {
    await rejects("update commerce.tripletex_sync set state = 'synced' where kind = 'customer'", [], /tripletex_sync_synced/);
    await rejects("update commerce.tripletex_sync set state = 'sending' where kind = 'work_invoice'", [], /tripletex_sync_voucher_key/);
    await db.query("update commerce.tripletex_sync set state = 'sending', external_key = 'kf/1a2b3c4d/W-1' where kind = 'work_invoice'");
    await db.query("update commerce.tripletex_sync set state = 'synced', their_id = 5001, their_ref = '2026/1' where kind = 'work_invoice'");
  });

  it("books one external number once per company", async () => {
    await expect(sync("work_credit_note", "00000000-0000-4000-8000-000000000002", "external_key", ["kf/1a2b3c4d/W-1"])).rejects.toThrow(/tripletex_sync_external_key/);
  });

  it("takes only its kinds and states, and short texts", async () => {
    await rejects("update commerce.tripletex_sync set kind = 'order' where kind = 'customer'", [], /tripletex_sync_kind/);
    await rejects("update commerce.tripletex_sync set state = 'lost' where kind = 'customer'", [], /tripletex_sync_state/);
    await rejects("update commerce.tripletex_sync set error_detail = repeat('x', 401) where kind = 'customer'", [], /tripletex_sync_texts/);
    await rejects("update commerce.tripletex_sync set posting = 0 where kind = 'customer'", [], /tripletex_sync_attempts/);
  });
});

describe("the Tripletex tables", () => {
  it("are private to the server", async () => {
    for (const table of ["tripletex_connections", "tripletex_sync"]) {
      const row = await one<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = $1",
        [table],
      );
      expect(row.relrowsecurity, table).toBe(true);
    }
  });

  it("are never copied with a store, hold no person's data, and stay out of the store's file", () => {
    expect(COPY_RULES.tripletex_connections.group).toBe("never");
    expect(COPY_RULES.tripletex_sync.group).toBe("never");
    expect(SECRET_TABLES).toContain("tripletex_connections");
    expect(NOT_PERSONAL.tripletex_connections).toBeTruthy();
    expect(NOT_PERSONAL.tripletex_sync).toBeTruthy();
    expect(STORE_EXPORT_LEFT_OUT.tripletex_connections).toBe("secret");
  });
});
