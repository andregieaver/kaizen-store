import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import type { PublishMode } from "@/lib/review-status";
import { ratingSummary, reviewsTag, type RatingSummary } from "@/lib/reviews";
import type { ShownReview } from "@/lib/review-view";

type Row = Record<string, unknown>;

/** Reviews shown at once on a product page; *Show more* fetches the next ones (`/api/reviews`). */
export const REVIEWS_SHOWN = 10;

export type ReviewFacts = {
  summary: RatingSummary;
  /** The newest published reviews. */
  latest: ShownReview[];
  /** How the store checks reviews, for *How reviews are checked*. */
  publish: PublishMode;
};

const shownReview = (r: Row): ShownReview => ({
  id: String(r.id),
  rating: Number(r.rating),
  title: (r.title as string | null) ?? null,
  body: (r.body as string | null) ?? null,
  authorName: String(r.author_name),
  locale: String(r.locale),
  writtenOn: String(r.written_on),
  bought: (r.bought as string | null) ?? null,
  verified: r.source === "buyer",
  importedFrom: (r.imported_from as string | null) ?? null,
  answer: (r.answer as string | null) ?? null,
});

const SHOWN_COLUMNS = sql`r.id, r.rating, r.title, r.body, r.author_name, r.locale, r.source, r.imported_from, r.answer, r.created_at,
  coalesce(r.written_on, r.created_at::date)::text as written_on, l.title as bought`;

/**
 * A product's published reviews as its page draws them (D301 9.5): how many gave each number of stars (counted in SQL, only published reviews of
 * this product) and the newest ten. Cached under the store's reviews tag; the page stays prerendered. Never a word of a review not published.
 */
export async function reviewFacts(storeId: string, productId: string): Promise<ReviewFacts> {
  "use cache";
  cacheTag(reviewsTag(storeId));
  cacheLife("hours");
  const [counts, latest, settings] = await Promise.all([
    readDb().execute<Row>(sql`
      select rating, count(*)::int as n from commerce.product_reviews
      where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and status = 'published'
      group by rating
    `),
    readDb().execute<Row>(sql`
      select ${SHOWN_COLUMNS}
      from commerce.product_reviews r
      left join commerce.order_lines l on l.store_id = r.store_id and l.id = r.order_line_id
      where r.store_id = ${storeId}::uuid and r.product_id = ${productId}::uuid and r.status = 'published'
      order by r.created_at desc, r.id desc
      limit ${REVIEWS_SHOWN}
    `),
    readDb().execute<Row>(sql`select publish from commerce.review_settings where store_id = ${storeId}::uuid`),
  ]);
  return {
    summary: ratingSummary(Object.fromEntries(counts.map((r) => [Number(r.rating), Number(r.n)]))),
    latest: latest.map(shownReview),
    publish: settings[0]?.publish === "at_once" ? "at_once" : "after_check",
  };
}

/** The next published reviews of a product after one already shown (keyset by when written and id), for *Show more*. */
export async function moreReviews(storeId: string, productId: string, after: { id: string }): Promise<{ reviews: ShownReview[]; more: boolean }> {
  const rows = await readDb().execute<Row>(sql`
    select ${SHOWN_COLUMNS}
    from commerce.product_reviews r
    left join commerce.order_lines l on l.store_id = r.store_id and l.id = r.order_line_id
    join commerce.product_reviews a on a.store_id = r.store_id and a.id = ${after.id}::uuid and a.product_id = r.product_id
    where r.store_id = ${storeId}::uuid and r.product_id = ${productId}::uuid and r.status = 'published'
      and (r.created_at, r.id) < (a.created_at, a.id)
    order by r.created_at desc, r.id desc
    limit ${REVIEWS_SHOWN + 1}
  `);
  return { reviews: rows.slice(0, REVIEWS_SHOWN).map(shownReview), more: rows.length > REVIEWS_SHOWN };
}
