import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { importKey, readReviewFile, type ImportOutcome } from "@/lib/review-import";

export type { ImportOutcome };

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * Reviews in and out of a store (D301 G3b, `docs/wave-5-marketing.md` 9.6). An import brings reviews written on another service, each for one of
 * the store's products by its handle, as an `import` review: never verified, published or waiting as the owner chooses, never more than 10,000 a
 * file, refused row by row with the line and the column. A file imported twice adds nothing the second time. The export writes the published
 * and waiting reviews, buyers' and imported, through the one CSV writer. A file is read in one request and kept nowhere.
 */

/** Refused rows shown on the page; the count says how many in all. */
const REFUSED_SHOWN = 100;
const BATCH = 500;

/** The store's main language and its day today (no review is written in the future); null when it takes no reviews. */
async function storeFacts(storeId: string): Promise<{ locale: string; today: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select s.locales[1] as locale, to_char(now() at time zone s.time_zone, 'YYYY-MM-DD') as today
    from commerce.stores s
    where s.id = ${storeId}::uuid and commerce.feature_on(s.id, 'reviews') and not (s.is_template or s.starter)
  `);
  return row ? { locale: String(row.locale), today: String(row.today) } : null;
}

/** Checks a file and, unless `check` is set, imports what can be imported in one transaction. */
export async function importReviews(
  storeId: string,
  accountId: string,
  bytes: Uint8Array,
  options: { from: string; publish: boolean; check: boolean },
): Promise<ImportOutcome> {
  const facts = await storeFacts(storeId);
  if (!facts) return { ok: false, problem: "closed" };
  const read = readReviewFile(bytes, options.from, facts.today);
  if (!read.ok) return read;
  const refused = [...read.refused];
  const handles = [...new Set(read.rows.map((r) => r.handle))];

  return db().transaction(async (tx) => {
    const products = new Map<string, string>();
    const known = new Set<string>();
    if (handles.length > 0) {
      const found = await tx.execute<Row>(sql`
        select id, handle from commerce.products
        where store_id = ${storeId}::uuid and kind <> 'gift_card' and handle in (select jsonb_array_elements_text(${JSON.stringify(handles)}::jsonb))
      `);
      for (const p of found) products.set(String(p.handle), String(p.id));
      // The imports already in the store for these products, so the same review is never added twice.
      const existing = await tx.execute<Row>(sql`
        select p.handle, r.rating, r.author_name, to_char(r.written_on, 'YYYY-MM-DD') as written_on, r.imported_from, r.body
        from commerce.product_reviews r join commerce.products p on p.store_id = r.store_id and p.id = r.product_id
        where r.store_id = ${storeId}::uuid and r.source = 'import'
          and r.product_id in (select jsonb_array_elements_text(${JSON.stringify([...products.values()])}::jsonb)::uuid)
      `);
      for (const e of existing) {
        known.add(
          importKey({
            handle: String(e.handle),
            rating: Number(e.rating),
            author: String(e.author_name),
            date: String(e.written_on),
            source: String(e.imported_from),
            body: (e.body as string | null) ?? null,
          }),
        );
      }
    }
    let duplicates = 0;
    const keep: { product_id: string; author_name: string; rating: number; title: string | null; body: string | null; imported_from: string; written_on: string }[] = [];
    for (const row of read.rows) {
      const productId = products.get(row.handle);
      if (!productId) {
        refused.push({ line: row.line, problem: "product" });
        continue;
      }
      const key = importKey(row);
      if (known.has(key)) {
        duplicates++;
        continue;
      }
      known.add(key);
      keep.push({ product_id: productId, author_name: row.author, rating: row.rating, title: row.title, body: row.body, imported_from: row.source, written_on: row.date });
    }
    refused.sort((a, b) => a.line - b.line);
    const result = {
      ok: true as const,
      checked: options.check,
      rows: read.rows.length + read.refused.length,
      imported: keep.length,
      published: options.publish,
      duplicates,
      refusedCount: refused.length,
      refused: refused.slice(0, REFUSED_SHOWN),
    };
    if (options.check || keep.length === 0) return result;

    await tx.execute(sql`select set_config('kaizen.review_writer', 'import', true)`);
    const status = options.publish ? "published" : "pending";
    for (let i = 0; i < keep.length; i += BATCH) {
      await tx.execute(sql`
        insert into commerce.product_reviews (store_id, product_id, source, imported_from, written_on, author_name, rating, title, body, locale, status, created_at)
        select ${storeId}::uuid, r.product_id, 'import', r.imported_from, r.written_on, r.author_name, r.rating, r.title, r.body, ${facts.locale}, ${status},
          r.written_on::timestamptz
        from jsonb_to_recordset(${JSON.stringify(keep.slice(i, i + BATCH))}::jsonb)
          as r(product_id uuid, author_name text, rating smallint, title text, body text, imported_from text, written_on date)
      `);
    }
    await audit(accountId, storeId, "review.imported", { imported: keep.length, duplicates, refused: refused.length, published: options.publish });
    return result;
  });
}

const EXPORT_COLUMNS = ["product_handle", "rating", "title", "body", "author", "date", "source", "verified", "status", "answer"];

/** The store's published and waiting reviews as a CSV, newest first; hidden ones stay out. */
export async function reviewsCsv(storeId: string): Promise<string> {
  const rows = await db().execute<Row>(sql`
    select p.handle, r.rating, r.title, r.body, r.author_name, r.source, r.imported_from, r.status, r.answer,
      to_char(coalesce(r.written_on, (r.created_at at time zone s.time_zone)::date), 'YYYY-MM-DD') as day
    from commerce.product_reviews r
    join commerce.products p on p.store_id = r.store_id and p.id = r.product_id
    join commerce.stores s on s.id = r.store_id
    where r.store_id = ${storeId}::uuid and r.status in ('published', 'pending')
    order by coalesce(r.written_on, r.created_at::date) desc, r.id
  `);
  const cells: Cell[][] = rows.map((r) => [
    String(r.handle),
    Number(r.rating),
    (r.title as string | null) ?? "",
    (r.body as string | null) ?? "",
    String(r.author_name),
    String(r.day),
    r.source === "import" ? String(r.imported_from) : "",
    r.source === "buyer" ? "yes" : "no",
    String(r.status),
    (r.answer as string | null) ?? "",
  ]);
  return writeCsv([EXPORT_COLUMNS, ...cells]);
}

export type ReviewsOverview = {
  counts: { pending: number; published: number; hidden: number };
  imported: number;
  average: number | null;
  /** Products with at least three published reviews, best first and worst first, ten each. */
  best: { product: string; average: number; count: number }[];
  worst: { product: string; average: number; count: number }[];
};

/** For the AI manager's `reviews_overview` (9.6): counts by state, the average and the best and worst products; never an author's name. */
export async function reviewsOverview(storeId: string): Promise<ReviewsOverview> {
  const [counts] = await db().execute<Row>(sql`
    select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'published')::int as published,
      count(*) filter (where status = 'hidden')::int as hidden, count(*) filter (where source = 'import')::int as imported,
      sum(rating) filter (where status = 'published')::int as stars
    from commerce.product_reviews where store_id = ${storeId}::uuid
  `);
  const perProduct = await db().execute<Row>(sql`
    select r.product_id, count(*)::int as n, sum(r.rating)::int as stars,
      coalesce((select t.title from commerce.product_translations t join commerce.stores s on s.id = t.store_id
                where t.store_id = r.store_id and t.product_id = r.product_id order by t.locale = s.locales[1] desc, t.locale limit 1), '') as title
    from commerce.product_reviews r
    where r.store_id = ${storeId}::uuid and r.status = 'published'
    group by r.store_id, r.product_id having count(*) >= 3
  `);
  // Averages in code, to one decimal half up from whole stars (as the product page's `ratingSummary()`).
  const avg = (stars: number, n: number) => Math.round((stars * 10) / n) / 10;
  const products = perProduct.map((p) => ({ product: String(p.title), average: avg(Number(p.stars), Number(p.n)), count: Number(p.n) }));
  const byBest = [...products].sort((a, b) => b.average - a.average || b.count - a.count);
  const published = Number(counts?.published ?? 0);
  return {
    counts: { pending: Number(counts?.pending ?? 0), published, hidden: Number(counts?.hidden ?? 0) },
    imported: Number(counts?.imported ?? 0),
    average: published > 0 ? avg(Number(counts?.stars ?? 0), published) : null,
    best: byBest.slice(0, 10),
    worst: [...byBest].reverse().slice(0, 10),
  };
}
