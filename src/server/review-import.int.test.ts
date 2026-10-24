import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseCsv } from "@/lib/csv";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ri = await import("./review-import");

type Row = Record<string, unknown>;

/**
 * Importing and exporting reviews (wave 5 unit G3b, D301, `docs/wave-5-marketing.md` 9.6): only the store's own products by handle, each an import
 * never verified, published or waiting as chosen; a check writes nothing; a file imported twice adds nothing; a refused row is named by its line;
 * the export holds the published and waiting ones, not the hidden; the overview counts and ranks without an author.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let accountId: string;
const enc = (text: string) => new TextEncoder().encode(text);

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', features = array['shop', 'reviews'] where id = ${id}::uuid`);
  return id;
}

async function product(store: string, handle: string): Promise<string> {
  const [p] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind) values (${store}::uuid, ${handle}, 'txcd_99999999', 'goods') returning id
  `);
  return String(p.id);
}

const head = "product_handle,rating,title,body,author,date,source\n";
const reviewsOf = async (store: string) =>
  db().execute<Row>(sql`select source, status, imported_from, written_on::text as written_on, author_name, rating, variant_id from commerce.product_reviews where store_id = ${store}::uuid order by author_name`);

beforeAll(async () => {
  storeId = await makeStore("ri-a");
  otherId = await makeStore("ri-b");
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(owner.account_id);
  await product(storeId, `lamp-${run}`);
  await product(storeId, `chair-${run}`);
  await product(otherId, `sofa-${run}`);
});

afterAll(async () => {
  await closeDb();
});

describe("importing reviews", () => {
  const file = enc(
    head +
      `lamp-${run},5,Bright,Lights the room.,Kari N.,2025-03-01,Judge.me\n` +
      `chair-${run},2,,Wobbly.,Ola,2025-04-01,\n` +
      `sofa-${run},4,,,Per,2025-05-01,\n` +
      `lamp-${run},9,,,Ann,2025-05-01,\n`,
  );

  it("checks a file without writing anything, naming refused rows by line", async () => {
    const checked = await ri.importReviews(storeId, accountId, file, { from: "Old shop", publish: false, check: true });
    expect(checked).toMatchObject({ ok: true, checked: true, rows: 4, imported: 2, duplicates: 0, refusedCount: 2 });
    // Another store's product is no product here, and a rating of 9 is not a rating.
    expect(checked.ok && checked.refused).toEqual([
      { line: 4, problem: "product" },
      { line: 5, problem: "rating" },
    ]);
    expect(await reviewsOf(storeId)).toEqual([]);
  });

  it("imports the good rows as imports, never verified, waiting or shown as chosen, and adds nothing the second time", async () => {
    const done = await ri.importReviews(storeId, accountId, file, { from: "Old shop", publish: false, check: false });
    expect(done).toMatchObject({ ok: true, checked: false, imported: 2 });
    const rows = await reviewsOf(storeId);
    expect(rows).toEqual([
      { source: "import", status: "pending", imported_from: "Judge.me", written_on: "2025-03-01", author_name: "Kari N.", rating: 5, variant_id: null },
      { source: "import", status: "pending", imported_from: "Old shop", written_on: "2025-04-01", author_name: "Ola", rating: 2, variant_id: null },
    ]);
    const again = await ri.importReviews(storeId, accountId, file, { from: "Old shop", publish: true, check: false });
    expect(again).toMatchObject({ ok: true, imported: 0, duplicates: 2 });
    expect((await reviewsOf(storeId)).length).toBe(2);
    // Nothing reached the other store.
    expect(await reviewsOf(otherId)).toEqual([]);
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${storeId}::uuid and action = 'review.imported' limit 1`);
    expect(entry?.action).toBe("review.imported");
  });

  it("refuses a file without the needed columns and a store without reviews", async () => {
    expect(await ri.importReviews(storeId, accountId, enc("handle,stars\nx,5\n"), { from: "x", publish: false, check: true })).toMatchObject({ ok: false, problem: "columns" });
    await db().execute(sql`update commerce.stores set features = array['shop'] where id = ${otherId}::uuid`);
    expect(await ri.importReviews(otherId, accountId, file, { from: "x", publish: false, check: true })).toEqual({ ok: false, problem: "closed" });
  });

  it("exports the published and waiting reviews, not the hidden, and counts them in the overview without an author", async () => {
    const more = enc(
      head +
        `lamp-${run},4,,,Liv,2025-06-01,Shop\n` +
        `lamp-${run},3,,,Mia,2025-06-02,Shop\n` +
        `chair-${run},1,,,Nils,2025-06-03,Shop\n`,
    );
    await ri.importReviews(storeId, accountId, more, { from: "", publish: true, check: false });
    await db().execute(sql`
      update commerce.product_reviews set status = 'hidden', hidden_reason = 'spam', moderated_at = now()
      where store_id = ${storeId}::uuid and author_name = 'Nils'
    `);
    const csv = parseCsv(await ri.reviewsCsv(storeId));
    expect(csv.rows[0]).toEqual(["product_handle", "rating", "title", "body", "author", "date", "source", "verified", "status", "answer"]);
    const authors = csv.rows.slice(1).map((r) => r[4]).sort();
    expect(authors).toEqual(["Kari N.", "Liv", "Mia", "Ola"]);
    expect(csv.rows.slice(1).every((r) => r[7] === "no")).toBe(true);

    await db().execute(sql`
      update commerce.product_reviews set status = 'published', moderated_at = now() where store_id = ${storeId}::uuid and status = 'pending'
    `);
    const overview = await ri.reviewsOverview(storeId);
    expect(overview.counts).toEqual({ pending: 0, published: 4, hidden: 1 });
    expect(overview.imported).toBe(5);
    // (5 + 4 + 3 + 2) / 4 = 3.5; only the lamp has three published reviews: (5 + 4 + 3) / 3 = 4.
    expect(overview.average).toBe(3.5);
    expect(overview.best).toEqual([{ product: "", average: 4, count: 3 }]);
    expect(JSON.stringify(overview)).not.toContain("Kari");
  });
});
