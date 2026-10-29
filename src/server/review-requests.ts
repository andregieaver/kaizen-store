import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CATCH_UP_DAYS } from "@/lib/automations";
import type { BroadcastContent } from "@/lib/broadcasts";
import { t } from "@/lib/i18n";
import { roomLeft } from "@/lib/limits";
import { REQUEST_BATCH, REQUEST_LINK_DAYS, REQUEST_PRODUCTS_SHOWN, REQUESTS_KEEP_DAYS, REVIEW_WINDOW_DAYS } from "@/lib/review-status";

import { PAID } from "./analytics-sql";
import { sendEmail, type SendOutcome } from "./email";
import { limitFor, usageNow } from "./limits";
import { log } from "./log";
import { marketingEmail } from "./marketing-email";
import type { Reviewer } from "./reviews";
import { storeById, type EmailStore } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Asking for reviews (D301 G3, `docs/wave-5-marketing.md` 9.6): the only writer of `commerce.review_requests`. Once per sold order, when its newest
 * reviewable line was received the store's `request_days` ago (after the requests were switched on, within D298's catch-up window), and only when
 * the order's address is `subscribed` on the list: asking for a review is marketing (BGH VI ZR 225/17), so it carries the subscriber's unsubscribe
 * link and headers and counts against the plan's marketing emails. Its link opens `/account/review/{token}`, where the order's things are reviewed
 * without signing in; the token is kept only as its hash.
 */

/** A paid order as D152 counts it, still the person's, not cancelled (D298's `SOLD`, as `reviews.ts` reads it). */
const SOLD = sql`(${PAID} and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null)`;

/** When a line was received (as `reviews.ts`'s `RECEIVED`). */
const RECEIVED = sql`case l.delivery
  when 'physical' then o.delivered_at
  when 'digital' then o.placed_at
  when 'service' then (
    select max(b.ends_at) from commerce.bookings b
    where b.store_id = l.store_id and b.order_line_id = l.id and b.status = 'confirmed' and b.no_show_at is null and b.ends_at <= now()
  )
end`;

/** The key a buyer's review of the order carries: the account's, else the hash of the order's address (as `buyerKeysOf()`). */
const BUYER_KEY = sql`case when o.customer_id is not null then 'c:' || o.customer_id::text
  else 'e:' || encode(sha256(convert_to(lower(trim(o.email)), 'UTF8')), 'hex') end`;

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Due = {
  orderId: string;
  email: string;
  locale: string;
  marketCode: string;
  token: string;
  /** The products still to be reviewed, newest received first (the order line's words). */
  products: string[];
};

/** Stores asking for reviews now: the switch on, the feature on, open and real. */
async function askingStores(only?: string): Promise<{ storeId: string; days: number; since: string }[]> {
  const rows = await db().execute<Row>(sql`
    select rs.store_id, rs.request_days, rs.requests_enabled_at
    from commerce.review_settings rs join commerce.stores s on s.id = rs.store_id
    where rs.requests_on and commerce.feature_on(s.id, 'reviews') and commerce.store_is_active(s.id) and not (s.is_template or s.starter)
      and (${only ?? null}::uuid is null or rs.store_id = ${only ?? null}::uuid)
  `);
  return rows.map((r) => ({ storeId: String(r.store_id), days: Number(r.request_days), since: String(r.requests_enabled_at) }));
}

/**
 * The store's orders due a request: sold, not asked before, the newest received reviewable line in the window, something still unreviewed by the
 * buyer, and the order's address subscribed (with the subscriber's unsubscribe token).
 */
async function dueOrders(storeId: string, days: number, since: string, now: Date): Promise<Due[]> {
  const at = now.toISOString();
  const rows = await db().execute<Row>(sql`
    with lines as (
      select o.id as order_id, ${BUYER_KEY} as buyer_key, v.product_id, l.title, ${RECEIVED} as received_at
      from commerce.orders o
      join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where o.store_id = ${storeId}::uuid and ${SOLD} and p.kind <> 'gift_card'
        and o.placed_at > ${at}::timestamptz - make_interval(days => ${REVIEW_WINDOW_DAYS})
        and not exists (select 1 from commerce.review_requests r where r.store_id = o.store_id and r.order_id = o.id)
    ), received as (
      select * from lines where received_at is not null and received_at > ${at}::timestamptz - make_interval(days => ${REVIEW_WINDOW_DAYS})
    ), due as (
      select order_id from received group by order_id
      having max(received_at) <= ${at}::timestamptz - make_interval(days => ${days})
        and max(received_at) >= ${since}::timestamptz
        and max(received_at) > ${at}::timestamptz - make_interval(days => ${days + CATCH_UP_DAYS})
    )
    select o.id as order_id, m.email, o.locale, o.market_code, m.token,
      (select array_agg(t.title order by t.received_at desc) from (
         select distinct on (r.product_id) r.product_id, r.title, r.received_at from received r
         where r.order_id = o.id and not exists (
           select 1 from commerce.product_reviews pr
           where pr.store_id = o.store_id and pr.product_id = r.product_id and pr.source = 'buyer' and pr.buyer_key = r.buyer_key
         )
         order by r.product_id, r.received_at desc
       ) t) as products
    from due d
    join commerce.orders o on o.store_id = ${storeId}::uuid and o.id = d.order_id
    join commerce.marketing_subscribers m on m.store_id = o.store_id and lower(m.email) = lower(o.email) and m.status = 'subscribed'
    order by o.placed_at
    limit ${REQUEST_BATCH}
  `);
  return rows
    .map((r) => ({
      orderId: String(r.order_id),
      email: String(r.email),
      locale: String(r.locale),
      marketCode: String(r.market_code).toLowerCase(),
      token: String(r.token),
      products: ((r.products as string[] | null) ?? []).map(String),
    }))
    .filter((d) => d.products.length > 0);
}

/** The request email's words in the order's language, as content `marketingEmail()` draws with the subscriber's footer and unsubscribe link. */
export function requestContent(storeName: string, locale: string, products: readonly string[], token: string): BroadcastContent {
  const r = t(locale.slice(0, 2)).reviews.request;
  const shown = products.slice(0, REQUEST_PRODUCTS_SHOWN);
  return {
    [locale]: {
      subject: r.subject(storeName),
      preview: r.intro(storeName),
      blocks: [
        { type: "heading", text: r.heading },
        { type: "paragraph", text: r.intro(storeName) },
        { type: "paragraph", text: [r.products, ...shown.map((p) => `• ${p}`)].join("\n") },
        { type: "button", text: r.button, url: `/account/review/${token}` },
        { type: "paragraph", text: r.noReward },
      ],
    },
  };
}

export type RequestRunResult = { sent: number; failed: number; skipped: number };

/** One run (the every-minute marketing job and tests): each asking store's due orders, each asked once. Never throws. */
export async function runReviewRequests(options: { only?: string; deadline?: number; now?: Date } = {}): Promise<RequestRunResult> {
  const result: RequestRunResult = { sent: 0, failed: 0, skipped: 0 };
  const now = options.now ?? new Date();
  const late = () => options.deadline !== undefined && Date.now() > options.deadline;
  try {
    for (const asking of await askingStores(options.only)) {
      if (late()) break;
      const due = await dueOrders(asking.storeId, asking.days, asking.since, now);
      if (due.length === 0) continue;
      const store: EmailStore | null = await storeById(asking.storeId);
      if (!store) continue;
      const allowed = await limitFor(asking.storeId, "marketing_emails_month");
      let room = allowed === null ? Infinity : roomLeft(await usageNow(asking.storeId, "marketing_emails_month", now), allowed);
      for (const order of due) {
        if (late()) break;
        const token = randomBytes(32).toString("base64url");
        // The row first: an order is never asked twice, even by two runs at once.
        const [claimed] = await db().execute<Row>(sql`
          insert into commerce.review_requests (store_id, order_id, token_hash, expires_at)
          values (${asking.storeId}::uuid, ${order.orderId}::uuid, ${tokenHash(token)}, ${now.toISOString()}::timestamptz + make_interval(days => ${REQUEST_LINK_DAYS}))
          on conflict do nothing returning order_id
        `);
        if (!claimed) {
          result.skipped++;
          continue;
        }
        // The plan's marketing emails for the month (D314): one that would pass it is not sent, and never later either.
        if (room < 1) {
          await db().execute(sql`update commerce.review_requests set outcome = 'suppressed' where store_id = ${asking.storeId}::uuid and order_id = ${order.orderId}::uuid`);
          result.skipped++;
          continue;
        }
        room--;
        const email = marketingEmail({
          store,
          content: requestContent(store.name, order.locale, order.products, token),
          locale: order.locale,
          marketCode: order.marketCode,
          token: order.token,
        });
        const outcome: SendOutcome = email
          ? await sendEmail({
              storeId: asking.storeId,
              kind: "marketing.review_request",
              to: order.email,
              email,
              fromName: store.name,
              replyTo: store.details.contactEmail ?? null,
              idempotencyKey: `review_request:${asking.storeId}:${order.orderId}`,
              headers: email.headers,
            })
          : "failed";
        const kept = outcome === "duplicate" ? "sent" : outcome;
        await db().execute(sql`update commerce.review_requests set outcome = ${kept} where store_id = ${asking.storeId}::uuid and order_id = ${order.orderId}::uuid`);
        if (kept === "sent" || kept === "logged") result.sent++;
        else result.failed++;
      }
    }
  } catch (error) {
    log("error", "review_requests.run_failed", {}, error);
  }
  return result;
}

export type Invitation = Extract<Reviewer, { kind: "invitation" }> & { orderNumber: string; /** The order's name, for the name shown by default. */ name: string };

/**
 * The order a request email's link opens, while the link works and the order is still the buyer's (never restricted or anonymised); null for a
 * token that is not one, another store's or a spent one, so the page says the same in every case.
 */
export async function invitationOf(storeId: string, token: string): Promise<Invitation | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select o.id, o.number, o.customer_id, ${BUYER_KEY} as buyer_key,
      coalesce(nullif(o.billing_address->>'name', ''), o.shipping_address->>'name', '') as name
    from commerce.review_requests r
    join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${storeId}::uuid and r.token_hash = ${tokenHash(token)} and r.expires_at > now()
      and o.restricted_at is null and o.anonymised_at is null
  `);
  if (!row) return null;
  return {
    kind: "invitation",
    orderId: String(row.id),
    orderNumber: String(row.number),
    customerId: row.customer_id ? String(row.customer_id) : null,
    buyerKey: String(row.buyer_key),
    name: String(row.name ?? ""),
  };
}

/** How many requests went in the last 30 days (the Reviews page's line). */
export async function requestsSent(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.review_requests
    where store_id = ${storeId}::uuid and outcome in ('sent', 'logged') and created_at > now() - interval '30 days'
  `);
  return Number(row?.n ?? 0);
}

/** Daily: request rows past their keeping go (their links ran out long before). */
export async function pruneReviewRequests(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.review_requests where created_at < now() - make_interval(days => ${REQUESTS_KEEP_DAYS}) returning 1
  `);
  return rows.length;
}
