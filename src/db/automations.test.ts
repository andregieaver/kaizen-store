import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the settings' checks and a back-in-stock request's life, as the database holds them. */

let db: PGlite;
let store: string;
let variant: string;
let product: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function request(email: string, status = "waiting"): Promise<string> {
  return scalar<string>(
    `insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status, confirm_hash, confirm_until)
     values ($1, $2, $3, $4, 'nb-NO', $5, case when $5 = 'pending' then md5($4) end, case when $5 = 'pending' then now() + interval '7 days' end) returning id`,
    [store, variant, product, email, status],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "au-a");
  product = await scalar<string>("insert into commerce.products (store_id, handle, tax_code) values ($1, 'mug', 'txcd_99999999') returning id", [store]);
  variant = await scalar<string>("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, 'MUG') returning id", [store, product]);
});

afterAll(async () => {
  await db.close();
});

describe("automations", () => {
  it("hold their days in range and words exactly where they are written", async () => {
    const content = JSON.stringify({ "nb-NO": { subject: "Velkommen", preview: "", blocks: [] } });
    await rejects("insert into commerce.automations (store_id, kind, delay_days, content) values ($1, 'welcome', 31, $2)", [store, content], /automations_delay/);
    await rejects("insert into commerce.automations (store_id, kind, delay_days, content) values ($1, 'win_back', 10, $2)", [store, content], /automations_delay/);
    await rejects("insert into commerce.automations (store_id, kind, delay_days) values ($1, 'after_purchase', 7)", [store], /automations_content/);
    await rejects("insert into commerce.automations (store_id, kind, content) values ($1, 'back_in_stock', $2)", [store, content], /automations_content/);
    await rejects("insert into commerce.automations (store_id, kind, delay_days, content, enabled) values ($1, 'welcome', 0, $2, true)", [store, content], /automations_enabled_at/);
    await db.query("insert into commerce.automations (store_id, kind, delay_days, content, enabled, enabled_at) values ($1, 'welcome', 0, $2, true, now())", [store, content]);
    await db.query("insert into commerce.automations (store_id, kind) values ($1, 'back_in_stock')", [store]);
    await rejects("update commerce.automations set kind = 'win_back' where store_id = $1 and kind = 'welcome'", [store], /stays itself/);
    await rejects("insert into commerce.automations (store_id, kind) values ($1, 'back_in_stock')", [store], /duplicate key/);
  });
});

describe("back-in-stock requests", () => {
  it("move only along their life", async () => {
    await rejects(
      "insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status) values ($1, $2, $3, 'a@example.com', 'nb-NO', 'sent')",
      [store, variant, product],
      /starts pending or waiting/,
    );
    await rejects(
      "insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status) values ($1, $2, $3, 'a@example.com', 'nb-NO', 'pending')",
      [store, variant, product],
      /needs its link/,
    );
    const id = await request("a@example.com", "pending");
    await rejects("update commerce.stock_requests set status = 'sent', notified_at = now() where id = $1", [id], /pending cannot become sent/);
    await db.query("update commerce.stock_requests set status = 'waiting', confirm_hash = null, confirmed_at = now() where id = $1", [id]);
    await rejects("update commerce.stock_requests set status = 'sent' where id = $1", [id], /says when/);
    await db.query("update commerce.stock_requests set status = 'sent', notified_at = now() where id = $1", [id]);
    await rejects("update commerce.stock_requests set status = 'waiting' where id = $1", [id], /sent cannot become waiting/);
    await rejects("update commerce.stock_requests set email = 'b@example.com' where id = $1", [id], /stays itself/);
  });

  it("are one open request per variant and address, in lower case", async () => {
    await rejects(
      "insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status) values ($1, $2, $3, 'Big@Example.com', 'nb-NO', 'waiting')",
      [store, variant, product],
      /stock_requests_email/,
    );
    const first = await request("c@example.com");
    await expect(request("c@example.com")).rejects.toThrow(/stock_requests_open_idx/);
    await db.query("update commerce.stock_requests set status = 'cancelled' where id = $1", [first]);
    // Once the first has ended, the address may ask again.
    expect(await request("c@example.com")).toBeTruthy();
  });

  it("go with their variant", async () => {
    const other = await scalar<string>("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, 'MUG-2') returning id", [store, product]);
    await db.query(
      "insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status) values ($1, $2, $3, 'd@example.com', 'nb-NO', 'waiting')",
      [store, other, product],
    );
    await db.query("delete from commerce.product_variants where id = $1", [other]);
    expect(await scalar<number>("select count(*)::int from commerce.stock_requests where variant_id = $1", [other])).toBe(0);
  });
});
