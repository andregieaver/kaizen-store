import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db/client";
import { classifyChannel } from "@/lib/analytics-traffic";
import { deviceOf, isBot } from "@/lib/experiments";
import { storeDomain, storeOrigins } from "@/lib/paths";
import { parseKey } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import { storeDayKey, visitorHash } from "@/lib/visit-hash";
import {
  fromStoresOwnPage,
  NEW_VISITS_PER_ADDRESS_WINDOW,
  NEW_VISITS_PER_STORE_DAY,
  PAGE_VIEW_CAP,
  placeOfPath,
  RETENTION_MONTHS,
  visitBody,
} from "@/lib/visit-record";

import { getOpenStore } from "./stores";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Cookieless visit counting (D152, docs/analytics.md, "Visit counting"). A page view comes in as a small beacon from the
 * store's own pages while the store has `visit_counting` on; it becomes one row per visitor and store day in
 * `commerce.visits` and a counter per product and day in `commerce.product_views`. No IP address and no user agent is ever
 * stored: they go into a keyed hash that changes every store day (`visitorHash()`, the day being `visits.day`), so a stored
 * id cannot be followed from one day to the next, and what is left is a device class (`deviceOf()`), a channel and a
 * landing path that is only ever one of a short list of shapes (`placeOfPath().landing`, never a raw path).
 *
 * Nothing here sets a cookie or reads one.
 */

/** Why a page view was not counted. Never shown to a browser: the endpoint answers every one of them the same way. */
export type VisitSkip =
  | "invalid"
  | "bot"
  | "privacy"
  | "unknown_store"
  | "off"
  | "no_key"
  | "wrong_site"
  | "unknown_page"
  | "capped"
  | "burst"
  | "store_full";
export type VisitOutcome = { recorded: true } | { recorded: false; reason: VisitSkip };

/**
 * The secret the daily keys come from: the settings key, kept apart from its other use (encrypting secrets) by deriving a
 * key for this purpose from it. Validated when used, so a build or a test without it still works; null when the server has none.
 */
export function visitSecret(env: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string | null {
  const key = parseKey(env);
  return key ? createHmac("sha256", key).update("kaizen:visit-counting").digest("hex") : null;
}

/** The client's address as the platform reports it; only ever fed to the hash, never stored. */
export const addressOf = (h: Headers): string => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "";

/** Global Privacy Control or Do Not Track sent with the request: the visit is not counted. */
export const wantsPrivacy = (h: Headers): boolean => h.get("sec-gpc") === "1" || h.get("dnt") === "1";

/** The hosts that are the store's own, so a visit coming from one is not a new source. */
function ownHostsOf(slug: string, requestHost: string | null): string[] {
  const hosts = [requestHost ?? "", ...storeOrigins(slug), siteUrl()];
  return hosts
    .map((value) => {
      try {
        return value.includes("://") ? new URL(value).host : value;
      } catch {
        return "";
      }
    })
    .filter((h) => h !== "");
}

/**
 * A short-lived key for the address in the new-row limit: a keyed hash of it for the store day, so the counter table holds no
 * address (and none that could be looked up without the secret). Deleted with the other counters after two days.
 */
const burstKey = (secret: string, day: string, address: string): string => createHmac("sha256", secret).update(`visit-burst|${day}|${address}`).digest("hex").slice(0, 24);

/** Counts a new visitor-day row against the address's and the store's limits, before it is written. */
async function takeNewVisit(storeId: string, address: string): Promise<"ok" | "burst" | "store_full"> {
  const count = async (bucket: string, window: ReturnType<typeof sql>) => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, ${bucket}, ${window}, 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
      returning count
    `);
    return Number(row.count);
  };
  if ((await count(`vn:${address}`, sql`date_bin('10 minutes', now(), '2000-01-01')`)) > NEW_VISITS_PER_ADDRESS_WINDOW) return "burst";
  if ((await count("visits", sql`date_trunc('day', now())`)) > NEW_VISITS_PER_STORE_DAY) return "store_full";
  return "ok";
}

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/**
 * Counts one page view. `body` is what the browser sent, checked here; `headers` are the request's (read for the user agent,
 * the address, the privacy signals and where the request came from, and for nothing else). The request must come from the
 * store's own page (`fromStoresOwnPage()`), so a store named in the body is the store of the page. The first page view of a
 * visitor's day makes a row and counts against the address's and the store's limits for new rows; the rest add to it. Writes
 * at most two statements' worth, in one: the day's row for the visitor (the first page view of the day makes it and decides
 * its channel) and, on a product page, the product's counter. A visitor past `PAGE_VIEW_CAP` page views in a day is not
 * counted further. These limits bound a script's effect; they do not make a count tamper-proof.
 */
export async function recordVisit({ headers: h, body, now = new Date() }: { headers: Headers; body: unknown; now?: Date }): Promise<VisitOutcome> {
  const parsed = visitBody.safeParse(body);
  if (!parsed.success) return { recorded: false, reason: "invalid" };
  const input = parsed.data;
  const userAgent = h.get("user-agent");
  if (isBot(userAgent)) return { recorded: false, reason: "bot" };
  if (wantsPrivacy(h)) return { recorded: false, reason: "privacy" };

  const store = await getOpenStore(input.store);
  if (!store) return { recorded: false, reason: "unknown_store" };
  if (!store.visitCounting) return { recorded: false, reason: "off" };
  const secret = visitSecret();
  if (!secret) return { recorded: false, reason: "no_key" };

  const requestHost = h.get("x-forwarded-host") ?? h.get("host");
  const own = fromStoresOwnPage({
    origin: h.get("origin"),
    referer: h.get("referer"),
    requestHost,
    slug: store.slug,
    ownHosts: storeOrigins(store.slug).map((origin) => new URL(origin).host),
    storesOnPlatformHost: storeDomain() === null,
  });
  if (!own) return { recorded: false, reason: "wrong_site" };

  // Every country the store had (D178): an order's page in a country no longer offered is still one of its pages.
  const place = placeOfPath(input.path, store.slug, store.allMarkets.map((m) => m.code), store.address);
  if (!place) return { recorded: false, reason: "unknown_page" };

  const channel = classifyChannel({
    referrerHost: input.referrer ?? "",
    ownHosts: ownHostsOf(store.slug, requestHost),
    utmSource: input.utm_source,
    utmMedium: input.utm_medium,
    utmCampaign: input.utm_campaign,
    clickIds: { gclid: input.gclid, fbclid: input.fbclid, ttclid: input.ttclid },
  });
  // One day clock: the store's calendar day is both the row's `day` and what the visitor's key is made for.
  const day = storeDayKey(now, store.timeZone);
  const address = addressOf(h);
  const visitor = visitorHash(store.id, address, userAgent, day, secret);
  const at = now.toISOString();

  // A visitor's first page view of the day starts a row, and rows are what a script could multiply by changing its user agent.
  const [known] = await db().execute<Row>(sql`select 1 as one from commerce.visits where store_id = ${store.id}::uuid and day = ${day}::date and visitor = ${visitor}`);
  if (!known) {
    const verdict = await takeNewVisit(store.id, burstKey(secret, day, address));
    if (verdict !== "ok") return { recorded: false, reason: verdict };
  }
  const product = place.kind === "product" && place.handle !== null;

  // One statement: the product (when the page is one that exists), the visitor's row for the store's day, and the product's
  // counter, which follows only when the row was written. The cap sits in the update's condition, so a visitor past it
  // changes nothing and nothing comes back.
  const [row] = await db().execute<Row>(sql`
    with prod as (
      select id from commerce.products
      where store_id = ${store.id}::uuid and handle = ${place.handle ?? ""} and ${product}::boolean
    ),
    up as (
      insert into commerce.visits as v
        (store_id, day, visitor, market_code, device, channel, source, campaign, landing_path, page_views, product_views, checkout_at, first_seen, last_seen)
      values (
        ${store.id}::uuid, ${day}::date, ${visitor}, ${place.market}::char(2),
        ${deviceOf(userAgent)}, ${channel.channel}, ${clip(channel.source, 100)}, ${clip(channel.campaign, 100)}, ${clip(place.landing, 300)},
        1, (select count(*)::int from prod), case when ${place.kind === "checkout"}::boolean then ${at}::timestamptz end, ${at}::timestamptz, ${at}::timestamptz
      )
      on conflict (store_id, day, visitor) do update set
        page_views = v.page_views + 1,
        last_seen = ${at}::timestamptz,
        product_views = v.product_views + (select count(*)::int from prod),
        checkout_at = coalesce(v.checkout_at, case when ${place.kind === "checkout"}::boolean then ${at}::timestamptz end)
      where v.page_views < ${PAGE_VIEW_CAP}
      returning day
    ),
    pv as (
      insert into commerce.product_views as p (store_id, day, product_id, views)
      select ${store.id}::uuid, up.day, prod.id, 1 from up cross join prod
      on conflict (store_id, day, product_id) do update set views = p.views + 1
      returning 1
    )
    select (select count(*) from up)::int as recorded, (select count(*) from pv)::int as product_counted
  `);
  return Number(row?.recorded ?? 0) > 0 ? { recorded: true } : { recorded: false, reason: "capped" };
}

/**
 * Ties a cart that has just been made to the visitor-day that made it (D152): the order paid from the cart then knows its
 * channel and device. Called by `openCart()` inside its transaction, after inserting a cart; it does nothing when the store
 * is not counting visits, when the request is a robot's or sends a privacy signal, or when no visit of the store's day was
 * counted. It runs as a savepoint of its own and swallows its failures: this must never stop anyone adding to the cart.
 *
 * This is the one place a visit meets anything else: from here on the visit row (a hashed id, a device class, a channel and a
 * landing page) belongs to a cart, and so to the order made from it and whoever placed it. Nothing is copied the other way.
 */
export async function attachVisitToCart(tx: Tx, storeId: string, cartId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const h = await headers();
    const secret = visitSecret();
    if (!secret || isBot(h.get("user-agent")) || wantsPrivacy(h)) return false;
    return await tx.transaction(async (savepoint) => {
      const [store] = await savepoint.execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid and visit_counting`);
      if (!store) return false;
      // The visitor's key and the visit's row are for the same store day, so one lookup finds it.
      const day = storeDayKey(now, String(store.time_zone));
      const visitor = visitorHash(storeId, addressOf(h), h.get("user-agent"), day, secret);
      const rows = await savepoint.execute<Row>(sql`
        update commerce.carts c set visit_id = v.id
        from (select id from commerce.visits where store_id = ${storeId}::uuid and day = ${day}::date and visitor = ${visitor} limit 1) v
        where c.store_id = ${storeId}::uuid and c.id = ${cartId}::uuid and c.visit_id is null
        returning c.id
      `);
      return rows.length > 0;
    });
  } catch (error) {
    console.warn(`[visits] a cart could not be tied to its visit: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const BATCH = 5_000;
/** Most batches one run deletes from one table of one store; a backlog is taken over the next days. */
const MAX_BATCHES = 40;

/**
 * Deletes visits and product counters older than 25 months (the daily job), a store at a time and in batches through the
 * `(store_id, day)` and primary-key indexes. Carts keep nothing of a deleted visit (`ON DELETE SET NULL`). Never throws:
 * what it managed is returned.
 */
export async function pruneVisits(now: Date = new Date()): Promise<{ visits: number; productViews: number }> {
  const done = { visits: 0, productViews: 0 };
  try {
    const stores = await db().execute<Row>(sql`select id from commerce.stores`);
    const cutoff = sql`((${now.toISOString()}::timestamptz at time zone 'UTC')::date - make_interval(months => ${RETENTION_MONTHS}))::date`;
    for (const store of stores) {
      const id = String(store.id);
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const gone = await db().execute<Row>(sql`
          delete from commerce.visits where id in (
            select id from commerce.visits where store_id = ${id}::uuid and day < ${cutoff} limit ${BATCH}
          ) returning 1
        `);
        done.visits += gone.length;
        if (gone.length < BATCH) break;
      }
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const gone = await db().execute<Row>(sql`
          delete from commerce.product_views where (store_id, day, product_id) in (
            select store_id, day, product_id from commerce.product_views where store_id = ${id}::uuid and day < ${cutoff} limit ${BATCH}
          ) returning 1
        `);
        done.productViews += gone.length;
        if (gone.length < BATCH) break;
      }
    }
  } catch (error) {
    console.warn(`[visits] pruning stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return done;
}
