import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { HIDE_REASONS, PUBLISH_MODES, REVIEW_STATUSES, type HideReason, type PublishMode, type ReviewSource, type ReviewStatus } from "@/lib/review-status";

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * Checking reviews (D301 G2, `docs/wave-5-marketing.md` 9.4): the admin's queue and its decisions. Staff publish, hide with a reason and answer;
 * nothing here can change a review's stars or words (the database refuses it). Every decision is audited (`review.*`, area products) with ids only.
 */

export const REVIEWS_PAGE = 25;

export type AdminReview = {
  id: string;
  productId: string;
  product: string;
  /** What the buyer bought (the order line's words), or null for an import. */
  bought: string | null;
  source: ReviewSource;
  importedFrom: string | null;
  status: ReviewStatus;
  hiddenReason: HideReason | null;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  locale: string;
  answer: string | null;
  orderId: string | null;
  orderNumber: string | null;
  writtenAt: string;
  editedAt: string | null;
};

export type ReviewCounts = Record<ReviewStatus, number>;

export async function reviewCounts(storeId: string): Promise<ReviewCounts> {
  const rows = await db().execute<Row>(sql`
    select status, count(*)::int as n from commerce.product_reviews where store_id = ${storeId}::uuid group by status
  `);
  const out = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0])) as ReviewCounts;
  for (const r of rows) out[r.status as ReviewStatus] = Number(r.n);
  return out;
}

export type ReviewListOptions = {
  status: ReviewStatus | null;
  /** Words of the product's name, the review or its author. */
  query: string;
  stars: number | null;
  /** Keyset: the last row of the page before (written at, id). */
  before: { at: string; id: string } | null;
};

/** The store's reviews, newest first (a status, words and stars to narrow them), a page at a time; `more` when there are older ones. */
export async function listReviews(storeId: string, options: ReviewListOptions): Promise<{ rows: AdminReview[]; more: boolean }> {
  const like = `%${options.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    select r.id, r.product_id, r.source, r.imported_from, r.status, r.hidden_reason, r.rating, r.title, r.body, r.author_name, r.locale, r.answer,
      r.order_id, r.created_at, r.edited_at, o.number as order_number, l.title as bought,
      coalesce((select t.title from commerce.product_translations t where t.store_id = r.store_id and t.product_id = r.product_id
        order by t.locale = s.locales[1] desc, t.locale limit 1), p.handle) as product
    from commerce.product_reviews r
    join commerce.stores s on s.id = r.store_id
    join commerce.products p on p.store_id = r.store_id and p.id = r.product_id
    left join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    left join commerce.order_lines l on l.store_id = r.store_id and l.id = r.order_line_id
    where r.store_id = ${storeId}::uuid
      ${options.status ? sql`and r.status = ${options.status}` : sql``}
      ${options.stars ? sql`and r.rating = ${options.stars}` : sql``}
      ${options.query
        ? sql`and (r.title ilike ${like} or r.body ilike ${like} or r.author_name ilike ${like} or p.handle ilike ${like}
            or exists (select 1 from commerce.product_translations t where t.store_id = r.store_id and t.product_id = r.product_id and t.title ilike ${like}))`
        : sql``}
      ${options.before ? sql`and (r.created_at, r.id) < (${options.before.at}::timestamptz, ${options.before.id}::uuid)` : sql``}
    order by r.created_at desc, r.id desc
    limit ${REVIEWS_PAGE + 1}
  `);
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    more: rows.length > REVIEWS_PAGE,
    rows: rows.slice(0, REVIEWS_PAGE).map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      product: String(r.product),
      bought: (r.bought as string | null) ?? null,
      source: r.source as ReviewSource,
      importedFrom: (r.imported_from as string | null) ?? null,
      status: r.status as ReviewStatus,
      hiddenReason: (r.hidden_reason as HideReason | null) ?? null,
      rating: Number(r.rating),
      title: (r.title as string | null) ?? null,
      body: (r.body as string | null) ?? null,
      authorName: String(r.author_name),
      locale: String(r.locale),
      answer: (r.answer as string | null) ?? null,
      orderId: (r.order_id as string | null) ?? null,
      orderNumber: (r.order_number as string | null) ?? null,
      writtenAt: iso(r.created_at) ?? "",
      editedAt: iso(r.edited_at),
    })),
  };
}

/** A decision changed what shoppers see: the caller refreshes `reviewsTag()`. */
export type Decided = { ok: true } | { ok: false; problem: "unknown" | "state" | "reason" | "answer" };

/** Publishes a waiting or hidden review. */
export async function publishReview(storeId: string, accountId: string, reviewId: string): Promise<Decided> {
  const [row] = await db().execute<Row>(sql`
    update commerce.product_reviews set status = 'published', hidden_reason = null, moderated_at = now(), moderated_by = ${accountId}::uuid
    where store_id = ${storeId}::uuid and id = ${reviewId}::uuid and status in ('pending', 'hidden')
    returning id
  `);
  if (!row) return { ok: false, problem: (await exists(storeId, reviewId)) ? "state" : "unknown" };
  await audit(accountId, storeId, "review.published", { review: reviewId }, { target: { type: "review", id: reviewId } });
  return { ok: true };
}

/** Hides a waiting or published review for one of the reasons a review may be hidden (never because it is negative). */
export async function hideReview(storeId: string, accountId: string, reviewId: string, reason: string): Promise<Decided> {
  if (!(HIDE_REASONS as readonly string[]).includes(reason)) return { ok: false, problem: "reason" };
  const [row] = await db().execute<Row>(sql`
    update commerce.product_reviews set status = 'hidden', hidden_reason = ${reason}, moderated_at = now(), moderated_by = ${accountId}::uuid
    where store_id = ${storeId}::uuid and id = ${reviewId}::uuid and status in ('pending', 'published')
    returning id
  `);
  if (!row) return { ok: false, problem: (await exists(storeId, reviewId)) ? "state" : "unknown" };
  await audit(accountId, storeId, "review.hidden", { review: reviewId, reason }, { target: { type: "review", id: reviewId } });
  return { ok: true };
}

/** The store's answer under a review, or none (`null` or empty takes it away). Plain text, at most 2 000 characters. */
export async function answerReview(storeId: string, accountId: string, reviewId: string, answer: string | null): Promise<Decided> {
  const text = answer?.replace(/\r\n?/g, "\n").trim() || null;
  if (text && [...text].length > 2000) return { ok: false, problem: "answer" };
  const [row] = await db().execute<Row>(sql`
    update commerce.product_reviews set answer = ${text}, answered_at = case when ${text}::text is null then null else now() end,
      answered_by = case when ${text}::text is null then null else ${accountId}::uuid end
    where store_id = ${storeId}::uuid and id = ${reviewId}::uuid
    returning id
  `);
  if (!row) return { ok: false, problem: "unknown" };
  await audit(accountId, storeId, "review.answered", { review: reviewId, answered: text !== null }, { target: { type: "review", id: reviewId } });
  return { ok: true };
}

async function exists(storeId: string, reviewId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select 1 from commerce.product_reviews where store_id = ${storeId}::uuid and id = ${reviewId}::uuid`);
  return Boolean(row);
}

/** Whether new and edited reviews wait for a check (`after_check`) or are published at once. Reviews already written keep their state. */
export async function savePublishMode(storeId: string, accountId: string, publish: string): Promise<boolean> {
  if (!(PUBLISH_MODES as readonly string[]).includes(publish)) return false;
  await db().execute(sql`
    insert into commerce.review_settings (store_id, publish) values (${storeId}::uuid, ${publish})
    on conflict (store_id) do update set publish = excluded.publish, updated_at = now()
  `);
  await audit(accountId, storeId, "review.settings", { publish: publish as PublishMode });
  return true;
}
