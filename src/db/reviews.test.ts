import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Product reviews (wave 5 unit G1, D301, `docs/wave-5-marketing.md` 9.1): the database's rules. */

let db: PGlite;
let store: string;
let other: string;
let staff: string;
let customer: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

/** Runs statements in one transaction with the given settings, as the server's writes do. */
async function inside(settings: Record<string, string>, statements: [string, unknown[]][]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(settings)) await tx.query("select set_config($1, $2, true)", [key, value]);
    for (const [sql, params] of statements) await tx.query(sql, params);
  });
}

type Line = { order: string; line: string; variant: string; product: string };

/** A paid order of one line; the fixture keeps one product per VAT category, so `category` gives another product. */
async function boughtLine(sku: string, s = store, category?: string): Promise<Line> {
  const placed = await placeOrder(db, s, { lines: [{ sku, unit: 20000, category }] });
  const row = (
    await db.query<{ variant: string; product: string }>(
      "select l.variant_id as variant, v.product_id as product from commerce.order_lines l join commerce.product_variants v on v.id = l.variant_id where l.id = $1",
      [placed.lineIds[0]],
    )
  ).rows[0];
  return { order: placed.id, line: placed.lineIds[0], ...row };
}

const INSERT = `insert into commerce.product_reviews (store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, customer_id, author_name, rating, title, body, locale, status)
  values ($1, $2, $3, 'buyer', $4, $5, $6, $7, 'Kari N.', $8, 'Fine', 'Good fit.', 'nb-NO', $9) returning id`;

async function review(l: Line, rating = 4, status = "pending", key = `c:${randomUUID()}`): Promise<string> {
  let id = "";
  await db.transaction(async (tx) => {
    await tx.query("select set_config('kaizen.review_writer', 'author', true)");
    id = (await tx.query<{ id: string }>(INSERT, [store, l.product, l.variant, l.order, l.line, key, customer, rating, status])).rows[0].id;
  });
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "rv-a");
  other = await createInvoiceStore(db, "rv-b");
  staff = await scalar<string>("insert into commerce.accounts (email, name) values ('rv-staff@example.com', 'Staff') returning id");
  customer = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'kari@example.com') returning id", [store]);
});

afterAll(async () => {
  await db.close();
});

describe("product reviews", () => {
  it("are written only by their buyer or as an import", async () => {
    const l = await boughtLine("RV-1");
    await rejects(INSERT, [store, l.product, l.variant, l.order, l.line, `c:${customer}`, customer, 5, "pending"], /product_reviews.writer/);
    await rejects(
      "insert into commerce.product_reviews (store_id, product_id, source, imported_from, written_on, author_name, rating, locale) values ($1, $2, 'import', 'Trustpilot', '2026-01-01', 'Ola', 5, 'nb-NO')",
      [store, l.product],
      /product_reviews.writer/,
    );
    await inside({ "kaizen.review_writer": "import" }, [
      [
        "insert into commerce.product_reviews (store_id, product_id, source, imported_from, written_on, author_name, rating, locale, status) values ($1, $2, 'import', 'Trustpilot', '2026-01-01', 'Ola', 5, 'nb-NO', 'published')",
        [store, l.product],
      ],
    ]);
    expect(await review(l)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("are of a line of their order and of a variant of their product", async () => {
    const a = await boughtLine("RV-2");
    const b = await boughtLine("RV-3", store, "exempt");
    await expect(review({ ...a, product: b.product, variant: b.variant })).rejects.toThrow(/product_reviews.line/);
    await expect(review({ ...a, line: b.line })).rejects.toThrow(/product_reviews.line/);
    // Another store's order cannot carry this store's review (the order's key is the store's).
    const foreign = await boughtLine("RV-X", other);
    await expect(review({ ...a, order: foreign.order, line: foreign.line })).rejects.toThrow(/product_reviews_order_fk|product_reviews.line/);
  });

  it("are one per order line and one per product and buyer", async () => {
    const l = await boughtLine("RV-4");
    await review(l, 5, "pending", `e:${"a".repeat(64)}`);
    await expect(review(l, 5, "pending", `e:${"b".repeat(64)}`)).rejects.toThrow(/product_reviews_line_key/);
    const again = await placeOrder(db, store, { lines: [{ sku: "RV-4", unit: 20000 }] });
    await expect(review({ ...l, order: again.id, line: again.lineIds[0] }, 3, "pending", `e:${"a".repeat(64)}`)).rejects.toThrow(/product_reviews_buyer_key/);
  });

  it("never start hidden or answered", async () => {
    const l = await boughtLine("RV-5");
    await expect(review(l, 4, "hidden")).rejects.toThrow(/product_reviews/);
  });

  it("change their stars and words only in the author's write", async () => {
    const l = await boughtLine("RV-6");
    const id = await review(l);
    await rejects("update commerce.product_reviews set rating = 5 where id = $1", [id], /product_reviews.words/);
    await rejects("update commerce.product_reviews set body = 'Better' where id = $1", [id], /product_reviews.words/);
    await expect(
      inside({ "kaizen.review_author": "00000000-0000-0000-0000-000000000000" }, [["update commerce.product_reviews set rating = 5 where id = $1", [id]]]),
    ).rejects.toThrow(/product_reviews.words/);
    await inside({ "kaizen.review_author": id }, [["update commerce.product_reviews set rating = 5, body = 'Better', edited_at = now() where id = $1", [id]]]);
    expect(await scalar("select rating from commerce.product_reviews where id = $1", [id])).toBe(5);
  });

  it("keep their product, order and author", async () => {
    const l = await boughtLine("RV-7");
    const id = await review(l);
    const m = await boughtLine("RV-8", store, "exempt");
    await rejects("update commerce.product_reviews set product_id = $2 where id = $1", [id, m.product], /product_reviews.fixed/);
    await rejects("update commerce.product_reviews set buyer_key = $2 where id = $1", [id, `e:${"c".repeat(64)}`], /product_reviews.fixed/);
  });

  it("move between states only as staff may, saying when", async () => {
    const l = await boughtLine("RV-9");
    const id = await review(l);
    await rejects("update commerce.product_reviews set status = 'published' where id = $1", [id], /product_reviews.moderated/);
    await db.query("update commerce.product_reviews set status = 'published', moderated_at = now(), moderated_by = $2 where id = $1", [id, staff]);
    await rejects("update commerce.product_reviews set status = 'pending', moderated_at = now() + interval '1 second' where id = $1", [id], /cannot become/);
    await rejects("update commerce.product_reviews set status = 'hidden', moderated_at = now() + interval '1 second' where id = $1", [id], /product_reviews_hidden/);
    await db.query("update commerce.product_reviews set status = 'hidden', hidden_reason = 'spam', moderated_at = now() + interval '1 second' where id = $1", [id]);
    // Staff answer without touching a word.
    await db.query("update commerce.product_reviews set answer = 'Thank you', answered_at = now(), answered_by = $2 where id = $1", [id, staff]);
    // The author's edit sends it back to the queue, never shown while it was hidden, and never touches the answer.
    await expect(
      inside({ "kaizen.review_author": id }, [["update commerce.product_reviews set body = 'Edited', edited_at = now() where id = $1", [id]]]),
    ).rejects.toThrow(/product_reviews.status/);
    await expect(
      inside({ "kaizen.review_author": id }, [["update commerce.product_reviews set body = 'Edited', answer = null, answered_at = null, status = 'pending', hidden_reason = null where id = $1", [id]]]),
    ).rejects.toThrow(/product_reviews.author/);
    await inside({ "kaizen.review_author": id }, [
      ["update commerce.product_reviews set body = 'Edited', edited_at = now(), status = 'pending', hidden_reason = null where id = $1", [id]],
    ]);
    expect(await scalar("select status from commerce.product_reviews where id = $1", [id])).toBe("pending");
  });

  it("are deleted only by their author or erasure", async () => {
    const l = await boughtLine("RV-10");
    const id = await review(l);
    await rejects("delete from commerce.product_reviews where id = $1", [id], /product_reviews.delete/);
    await inside({ "kaizen.review_delete": "on" }, [["delete from commerce.product_reviews where id = $1", [id]]]);
    expect(await scalar("select count(*)::int from commerce.product_reviews where id = $1", [id])).toBe(0);
  });

  it("take the feature reviews", async () => {
    await db.query("update commerce.stores set features = features || array['reviews'] where id = $1", [store]);
    expect(await scalar("select commerce.feature_on($1, 'reviews')", [store])).toBe(true);
    await rejects("update commerce.stores set features = features || array['opinions'] where id = $1", [store], /stores_features/);
  });

  it("keep their settings within their limits", async () => {
    await rejects("insert into commerce.review_settings (store_id, publish) values ($1, 'never')", [store], /review_settings_publish/);
    await rejects("insert into commerce.review_settings (store_id, request_days) values ($1, 2)", [store], /review_settings_days/);
    await rejects("insert into commerce.review_settings (store_id, requests_on) values ($1, true)", [store], /review_settings_requests/);
    await db.query("insert into commerce.review_settings (store_id, publish) values ($1, 'at_once')", [store]);
  });
});
