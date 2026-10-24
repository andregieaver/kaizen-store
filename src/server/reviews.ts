import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { REVIEW_WINDOW_DAYS, REVIEW_WRITES_A_DAY, type PublishMode, type ReviewStatus } from "@/lib/review-status";
import type { ReviewInput } from "@/lib/reviews";

import { PAID } from "./analytics-sql";

type Row = Record<string, unknown>;

/**
 * Product reviews (wave 5 unit G, D301, `docs/wave-5-marketing.md` 9): the only writer of `commerce.product_reviews` and `review_settings`. Only a buyer
 * writes, from an order line they bought and received (`reviewableLines()`, checked again under the line's lock); the words and stars change only
 * in the author's own transaction (`kaizen.review_author`), which the database asks for.
 */

/** A paid order as D152 counts it, still the person's (never restricted or anonymised), not cancelled: D298's `SOLD`. */
const SOLD = sql`(${PAID} and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null)`;

/**
 * When a line was received, or null: goods when the order was delivered (sent in full and delivered, or collected), a download when the order was
 * paid (placed), a service when its booking ended, confirmed and not a no-show.
 */
const RECEIVED = sql`case l.delivery
  when 'physical' then o.delivered_at
  when 'digital' then o.placed_at
  when 'service' then (
    select max(b.ends_at) from commerce.bookings b
    where b.store_id = l.store_id and b.order_line_id = l.id and b.status = 'confirmed' and b.no_show_at is null and b.ends_at <= now()
  )
end`;

/** The buyer keys a person's reviews carry (D301 9.1): their account's, and for G3's guests each of their proven addresses' hash. */
export function buyerKeysOf(customerId: string | null, emails: readonly string[]): string[] {
  const keys = emails.map((e) => `e:${createHash("sha256").update(e.trim().toLowerCase()).digest("hex")}`);
  return customerId ? [`c:${customerId}`, ...keys] : keys;
}

export type ReviewSettings = { publish: PublishMode; requestsOn: boolean; requestDays: number };

export async function reviewSettings(storeId: string, executor: Db = db()): Promise<ReviewSettings> {
  const [row] = await executor.execute<Row>(sql`select publish, requests_on, request_days from commerce.review_settings where store_id = ${storeId}::uuid`);
  return {
    publish: row?.publish === "at_once" ? "at_once" : "after_check",
    requestsOn: Boolean(row?.requests_on),
    requestDays: row ? Number(row.request_days) : 14,
  };
}

/** Reviews can be written in the store now: the feature on (with the shop) and a real store that is open. */
export async function reviewsOpen(storeId: string, executor: Db = db()): Promise<boolean> {
  const [row] = await executor.execute<Row>(sql`
    select commerce.feature_on(s.id, 'reviews') and commerce.store_is_active(s.id) and not (s.is_template or s.starter) as open
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return Boolean(row?.open);
}

export type OwnReview = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  answer: string | null;
  createdAt: string;
  editedAt: string | null;
};

export type ReviewableLine = {
  orderId: string;
  orderNumber: string;
  lineId: string;
  productId: string;
  variantId: string;
  handle: string;
  /** The line's own words as bought (*Shirt, M*). */
  title: string;
  receivedAt: string;
  /** The buyer's review of this product, written from this line or another of theirs. */
  review: OwnReview | null;
};

const ownReview = (r: Row): OwnReview | null =>
  r.review_id
    ? {
        id: String(r.review_id),
        status: r.review_status as ReviewStatus,
        rating: Number(r.rating),
        title: (r.review_title as string | null) ?? null,
        body: (r.review_body as string | null) ?? null,
        authorName: String(r.author_name),
        answer: (r.answer as string | null) ?? null,
        createdAt: new Date(String(r.review_created_at)).toISOString(),
        editedAt: r.edited_at ? new Date(String(r.edited_at)).toISOString() : null,
      }
    : null;

/**
 * Who writes (9.3, 9.6): the signed-in customer, from any of their orders, or the holder of a request email's link, from that one order (the
 * customer's key when the order has an account, else the hash of the order's email, so a guest's review is still one per product and buyer).
 */
export type Reviewer = { kind: "customer"; customerId: string } | { kind: "invitation"; orderId: string; customerId: string | null; buyerKey: string };

const keyOf = (who: Reviewer) => (who.kind === "customer" ? `c:${who.customerId}` : who.buyerKey);

/**
 * What the reviewer may review in the store, newest received first, one line per product (the newest it was received on), with their review of
 * it when they wrote one. The one reader of who may review what (9.2); `lineId` asks for one line, `lock` locks it for a write.
 */
export async function reviewableLinesFor(
  storeId: string,
  who: Reviewer,
  options: { lineId?: string; executor?: Db; lock?: boolean } = {},
): Promise<ReviewableLine[]> {
  const executor = options.executor ?? db();
  const whose = who.kind === "customer" ? sql`o.customer_id = ${who.customerId}::uuid` : sql`o.id = ${who.orderId}::uuid`;
  const one = options.lineId ? sql`and l.id = ${options.lineId}::uuid` : sql``;
  const lock = options.lock ? sql`for update of l` : sql``;
  const rows = await executor.execute<Row>(sql`
    with bought as (
      select o.id as order_id, o.number, l.id as line_id, l.variant_id, v.product_id, p.handle, l.title, ${RECEIVED} as received_at
      from commerce.orders o
      join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where o.store_id = ${storeId}::uuid and ${whose} and ${SOLD} and p.kind <> 'gift_card' ${one}
      ${lock}
    ), received as (
      select distinct on (b.product_id) b.* from bought b
      where b.received_at is not null and b.received_at > now() - make_interval(days => ${REVIEW_WINDOW_DAYS})
      order by b.product_id, b.received_at desc
    )
    select r.*, pr.id as review_id, pr.status as review_status, pr.rating, pr.title as review_title, pr.body as review_body, pr.author_name,
      pr.answer, pr.created_at as review_created_at, pr.edited_at
    from received r
    left join commerce.product_reviews pr on pr.store_id = ${storeId}::uuid and pr.product_id = r.product_id and pr.source = 'buyer'
      and pr.buyer_key = ${keyOf(who)}
    order by r.received_at desc
  `);
  return rows.map((r) => ({
    orderId: String(r.order_id),
    orderNumber: String(r.number),
    lineId: String(r.line_id),
    productId: String(r.product_id),
    variantId: String(r.variant_id),
    handle: String(r.handle),
    title: String(r.title),
    receivedAt: new Date(String(r.received_at)).toISOString(),
    review: ownReview(r),
  }));
}

/** What the signed-in customer may review (`reviewableLinesFor()` for their account). */
export function reviewableLines(storeId: string, customerId: string, options: { lineId?: string; executor?: Db; lock?: boolean } = {}): Promise<ReviewableLine[]> {
  return reviewableLinesFor(storeId, { kind: "customer", customerId }, options);
}

/** Whether the store takes reviews now, and how many lines the customer could review (for My account's link). */
export async function reviewsForAccount(storeId: string, customerId: string): Promise<{ open: boolean; lines: ReviewableLine[] }> {
  const open = await reviewsOpen(storeId, db());
  return { open, lines: open ? await reviewableLines(storeId, customerId) : [] };
}

/** One write from a reviewer's day of `REVIEW_WRITES_A_DAY`, atomically (`commerce.chat_usage`, bucket `review:{customer}` or the guest's key). */
async function takeWrite(executor: Db, storeId: string, who: Reviewer): Promise<boolean> {
  const bucket = `review:${who.customerId ?? keyOf(who)}`;
  const [row] = await executor.execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= REVIEW_WRITES_A_DAY;
}

export type WriteOutcome =
  | { ok: true; reviewId: string; status: ReviewStatus; /** The product page's reviews changed (one shown, or one shown taken back). */ shownChanged: boolean }
  | { ok: false; problem: "closed" | "not_reviewable" | "limit" };

/**
 * Writes the signed-in customer's review from one of their received lines (9.3): a new one, or their review of that product edited. With the
 * store's `after_check` it waits for staff (an edit goes back to the queue); with `at_once` a new one is published and an edit of a shown one stays
 * shown. The line is checked again under its lock; the words come cleaned (`cleanReview()`), in the market's language.
 */
export function writeReview(storeId: string, customerId: string, lineId: string, input: ReviewInput, locale: string): Promise<WriteOutcome> {
  return writeReviewAs(storeId, { kind: "customer", customerId }, lineId, input, locale);
}

/** `writeReview()` for any reviewer: the signed-in customer, or a request email's link for its order (9.6). */
export async function writeReviewAs(storeId: string, who: Reviewer, lineId: string, input: ReviewInput, locale: string): Promise<WriteOutcome> {
  const customerId = who.customerId;
  return db().transaction(async (tx) => {
    if (!(await reviewsOpen(storeId, tx))) return { ok: false, problem: "closed" } as const;
    const [line] = await reviewableLinesFor(storeId, who, { lineId, executor: tx, lock: true });
    if (!line) return { ok: false, problem: "not_reviewable" } as const;
    if (!(await takeWrite(tx, storeId, who))) return { ok: false, problem: "limit" } as const;
    const { publish } = await reviewSettings(storeId, tx);
    const existing = line.review;
    if (!existing) {
      const status: ReviewStatus = publish === "at_once" ? "published" : "pending";
      await tx.execute(sql`select set_config('kaizen.review_writer', 'author', true)`);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.product_reviews (store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, customer_id,
          author_name, rating, title, body, locale, status)
        values (${storeId}::uuid, ${line.productId}::uuid, ${line.variantId}::uuid, 'buyer', ${line.orderId}::uuid, ${line.lineId}::uuid,
          ${keyOf(who)}, ${customerId}::uuid, ${input.name}, ${input.rating}, ${input.title}, ${input.body}, ${locale}, ${status})
        returning id
      `);
      return { ok: true, reviewId: String(row.id), status, shownChanged: status === "published" } as const;
    }
    // An edit: a shown review stays shown with `at_once`; anything else waits for staff again (a hidden one is checked again, never shown at once).
    const status: ReviewStatus = publish === "at_once" && existing.status === "published" ? "published" : "pending";
    await tx.execute(sql`select set_config('kaizen.review_author', ${existing.id}, true)`);
    await tx.execute(sql`
      update commerce.product_reviews set author_name = ${input.name}, rating = ${input.rating}, title = ${input.title}, body = ${input.body},
        locale = ${locale}, edited_at = now(), status = ${status}, hidden_reason = case when ${status} = 'hidden' then hidden_reason end
      where store_id = ${storeId}::uuid and id = ${existing.id}::uuid
    `);
    return { ok: true, reviewId: existing.id, status, shownChanged: existing.status === "published" } as const;
  });
}

/** Deletes the customer's own review (9.3), whatever its state; true when it was shown, so the product page is refreshed. Null: not theirs. */
export async function deleteOwnReview(storeId: string, customerId: string, reviewId: string): Promise<{ wasShown: boolean } | null> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('kaizen.review_delete', 'on', true)`);
    const [row] = await tx.execute<Row>(sql`
      delete from commerce.product_reviews
      where store_id = ${storeId}::uuid and id = ${reviewId}::uuid and source = 'buyer' and buyer_key = ${`c:${customerId}`}
      returning status
    `);
    return row ? { wasShown: row.status === "published" } : null;
  });
}
