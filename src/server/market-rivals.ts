import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  OFFERS_PER_RIVAL,
  onRivalSite,
  PLATFORM_WATCH_DAYS,
  PLATFORM_WATCH_PER_RUN,
  priceOnPage,
  RIVAL_RETRY_DAYS,
  RIVAL_WATCH_DAYS,
  RIVALS_PER_MARKET,
  rivalHost,
  WATCH_PER_RUN,
  WATCH_PER_STORE_DAY,
  type OfferState,
  type OwnPrice,
  type RivalOfferFacts,
} from "@/lib/market-rivals";
import { amountMinor, type PageOffer } from "@/lib/offer-data";
import { normaliseSource } from "@/lib/research";

import { audit } from "./auth";
import { jobReport } from "./cache-events";
import { isDemoProduct } from "./demo-content";
import { OwnerToolError } from "./owner-tool-error";
import { readOfferPage, readWebPage, type ResearchActor, type ResearchDeps } from "./research";
import { getStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's rivals (D900 M2, `docs/market-check.md` 4), the only writer of `commerce.market_rivals` and `commerce.rival_offers`. A rival
 * is added by a person on Analytics → Markets, so every rival is one the owner recognises; an offer is read from the rival's own product
 * page through `readOfferPage()` (robots.txt first, the page's JSON-LD only, kept as a research source) and held against one of the store's
 * products. Its price is never read off a page's words, and nothing here changes what shoppers see. Since M3 the watcher reads each kept
 * offer's page again before it goes old (`watchRivals()`), and every read that changes the price, availability, shipping or returns keeps
 * what they were (`previous`, `changed_at`), whoever read it. Since M4 it also keeps the other store platforms' prices
 * (`commerce.platform_rival_prices`, the platform's own rows): kept by a platform admin with the page they came from, checked on that page
 * by code when kept and monthly after.
 */

export type RivalProblem = "market" | "name" | "host" | "full" | "exists" | "rival" | "site" | "product" | "offers" | "no_offer";

export class RivalError extends Error {
  constructor(readonly problem: RivalProblem) {
    super(problem);
  }
}

export type Rival = { id: string; market: string; name: string; host: string; createdAt: string };

export type KeptOffer = RivalOfferFacts & {
  id: string;
  rivalId: string;
  host: string;
  address: string;
  /** The rival's product name as its page gives it; `productName` is the store's own product it is held against. */
  name: string;
  productId: string | null;
  highPriceMinor: number | null;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
};

const RIVAL = z.object({ id: col.uuid, market: col.text, name: col.text, host: col.text, created_at: col.text });

export async function listRivals(storeId: string): Promise<Rival[]> {
  const rows = await typedRows(
    RIVAL,
    sql`select id, market_code::text as market, name, host, created_at::text from commerce.market_rivals where store_id = ${storeId}::uuid order by market_code, lower(name)`,
  );
  return rows.map((r) => ({ id: r.id, market: r.market, name: r.name, host: r.host, createdAt: r.created_at }));
}

/** Adds a rival in one of the store's countries, by its name and web address; refused past `RIVALS_PER_MARKET` or for a shop already there. */
export async function addRival(actor: { account: { id: string }; store: Store }, input: { market: string; name: string; address: string }): Promise<Rival> {
  const market = input.market.trim().toUpperCase();
  if (!actor.store.markets.some((m) => m.code === market)) throw new RivalError("market");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) throw new RivalError("name");
  const host = rivalHost(input.address);
  if (!host) throw new RivalError("host");
  const count = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.market_rivals where store_id = ${actor.store.id}::uuid and market_code = ${market}`,
  );
  if ((count?.n ?? 0) >= RIVALS_PER_MARKET) throw new RivalError("full");
  const row = await typedRow(
    RIVAL,
    sql`insert into commerce.market_rivals (store_id, market_code, name, host, added_by)
      values (${actor.store.id}::uuid, ${market}, ${name}, ${host}, ${actor.account.id}::uuid)
      on conflict (store_id, market_code, host) do nothing
      returning id, market_code::text as market, name, host, created_at::text`,
  );
  if (!row) throw new RivalError("exists");
  await audit(actor.account.id, actor.store.id, "analytics.rival_added", { rival: row.id, market, host });
  return { id: row.id, market: row.market, name: row.name, host: row.host, createdAt: row.created_at };
}

/** Removes a rival and the offers read of it. */
export async function removeRival(actor: { account: { id: string }; store: Store }, rivalId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(rivalId)) return false;
  const row = await typedRow(
    z.object({ id: col.uuid, host: col.text }),
    sql`delete from commerce.market_rivals where store_id = ${actor.store.id}::uuid and id = ${rivalId}::uuid returning id, host`,
  );
  if (row) await audit(actor.account.id, actor.store.id, "analytics.rival_removed", { rival: row.id, host: row.host });
  return Boolean(row);
}

/** A rival of the store's by its id, its host (`shop.example`) or its name, without regard to case. */
export async function findRival(storeId: string, which: string): Promise<Rival | null> {
  const key = which.trim();
  const host = rivalHost(key);
  const isId = /^[0-9a-f-]{36}$/i.test(key);
  const [row] = await typedRows(
    RIVAL,
    sql`select id, market_code::text as market, name, host, created_at::text from commerce.market_rivals
      where store_id = ${storeId}::uuid and (${isId ? sql`id = ${key}::uuid` : sql`false`} or host = ${host ?? ""} or lower(name) = lower(${key}))
      order by created_at limit 1`,
  );
  return row ? { id: row.id, market: row.market, name: row.name, host: row.host, createdAt: row.created_at } : null;
}

/** The store's own product by its handle, not archived; null when it has none by that handle. */
async function productByHandle(storeId: string, handle: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = ${handle.trim()} and status <> 'archived'`,
  );
  return row?.id ?? null;
}

/**
 * Reads a rival's product page and keeps its offer (the page's first `Product` with a price), held against the store's product named by
 * `product` (its handle) when given. The page must be on the rival's own site. Reading the same page again replaces what was kept of it.
 */
export async function readRivalOffer(
  actor: { account: { id: string }; store: Store },
  input: { rival: string; page: string; product?: string | null },
  deps: ResearchDeps = {},
): Promise<{ offer: PageOffer; kept: string }> {
  const rival = await findRival(actor.store.id, input.rival);
  if (!rival) throw new RivalError("rival");
  if (!onRivalSite(rival.host, input.page)) throw new RivalError("site");
  const productId = input.product?.trim() ? await productByHandle(actor.store.id, input.product) : null;
  if (input.product?.trim() && !productId) throw new RivalError("product");
  const kept = await typedRow(
    z.object({ n: col.int, here: col.bool }),
    sql`select count(*)::int as n, coalesce(bool_or(address = ${input.page}), false) as here from commerce.rival_offers where store_id = ${actor.store.id}::uuid and rival_id = ${rival.id}::uuid`,
  );
  if ((kept?.n ?? 0) >= OFFERS_PER_RIVAL && !kept?.here) throw new RivalError("offers");
  const research: ResearchActor = { account: actor.account, store: actor.store };
  const read = await readOfferPage(research, { url: input.page }, deps);
  const offer = read.offers[0];
  if (!offer) throw new RivalError("no_offer");
  const row = await keepOffer(actor.store.id, rival.id, productId, input.page, offer);
  return { offer, kept: row.id };
}

/**
 * Keeps a read of an offer's page: a new row, or the page's row replaced. Where the read differs from what was kept in price, currency,
 * availability, shipping or returns (`offerChanged()`'s comparison, in SQL), what was kept becomes `previous` and `changed_at` is now, so a
 * person's read, the AI manager's and the watcher's alike keep what moved (D900 M3). The product it is held against is kept when none is named.
 */
async function keepOffer(storeId: string, rivalId: string, productId: string | null, address: string, offer: PageOffer): Promise<{ id: string; changed: boolean }> {
  const row = await typedRow(
    z.object({ id: col.uuid, changed: col.bool }),
    sql`insert into commerce.rival_offers as o (store_id, rival_id, product_id, address, name, price_minor, currency, high_price_minor, availability,
        shipping_minor, shipping_currency, delivery_days_min, delivery_days_max, return_days, read_at)
      values (${storeId}::uuid, ${rivalId}::uuid, ${productId}::uuid, ${address}, ${offer.name.slice(0, 300)}, ${offer.priceMinor}, ${offer.currency},
        ${offer.highPriceMinor}, ${offer.availability}, ${offer.shippingMinor}, ${offer.shippingCurrency}, ${offer.deliveryDaysMin}, ${offer.deliveryDaysMax},
        ${offer.returnDays}, now())
      on conflict (rival_id, address) do update set
        product_id = coalesce(excluded.product_id, o.product_id), name = excluded.name, price_minor = excluded.price_minor,
        currency = excluded.currency, high_price_minor = excluded.high_price_minor, availability = excluded.availability,
        shipping_minor = excluded.shipping_minor, shipping_currency = excluded.shipping_currency, delivery_days_min = excluded.delivery_days_min,
        delivery_days_max = excluded.delivery_days_max, return_days = excluded.return_days, read_at = excluded.read_at,
        previous = case when ${CHANGED} then jsonb_build_object('priceMinor', o.price_minor, 'currency', o.currency, 'availability', o.availability,
            'shippingMinor', o.shipping_minor, 'shippingCurrency', o.shipping_currency, 'returnDays', o.return_days, 'readAt', o.read_at)
          else o.previous end,
        changed_at = case when ${CHANGED} then excluded.read_at else o.changed_at end
      returning id, coalesce(changed_at = read_at, false) as changed`,
  );
  if (!row) throw new Error("rival_offers: the upsert returned no row");
  return row;
}

/** Whether the read being kept (`excluded`) differs from the row kept (`o`) in what is compared. */
const CHANGED = sql`(o.price_minor, o.currency, o.availability, o.shipping_minor, o.shipping_currency, o.return_days)
  is distinct from (excluded.price_minor, excluded.currency, excluded.availability, excluded.shipping_minor, excluded.shipping_currency, excluded.return_days)`;

export type WatchDeps = ResearchDeps & { now?: Date; perRun?: number };
export type WatchRun = { read: number; changed: number; failed: number; platform: PlatformWatchRun };

/**
 * The watcher (D900 M3, the five-minute dispatcher's `rivalWatch`): a few kept offers read longer ago than `RIVAL_WATCH_DAYS` are read
 * again from their own pages, before they go old, oldest first, at most `WATCH_PER_STORE_DAY` a store a day so its own research keeps the
 * rest of its pages. Each is read as the person who added the rival (`readOfferPage()`: robots.txt first, the day's pages, kept as a
 * source), only for an open store that is not Kaizena Flow's own, and only while that person can still be named. The try is claimed first
 * (`watched_at`), so a page that cannot be read waits `RIVAL_RETRY_DAYS`; a page that no longer states an offer is left as it was and goes
 * old. No AI: code reads the page's data, and `keepOffer()` keeps what moved.
 */
export async function watchRivals(deps: WatchDeps = {}): Promise<WatchRun> {
  const report = jobReport();
  const now = deps.now ?? new Date();
  const due = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, slug: col.text, rival_id: col.uuid, address: col.text, added_by: col.uuid }),
    sql`
      with claimed as (
        update commerce.rival_offers o set watched_at = ${now.toISOString()}::timestamptz
        where o.id in (
          select o2.id from commerce.rival_offers o2
          join commerce.market_rivals r on r.store_id = o2.store_id and r.id = o2.rival_id
          join commerce.stores s on s.id = o2.store_id
          where r.added_by is not null and not s.house and commerce.store_is_active(o2.store_id)
            and o2.read_at < ${now.toISOString()}::timestamptz - make_interval(days => ${RIVAL_WATCH_DAYS})
            and (o2.watched_at is null or o2.watched_at < ${now.toISOString()}::timestamptz - make_interval(days => ${RIVAL_RETRY_DAYS}))
            and (select count(*) from commerce.rival_offers w
                 where w.store_id = o2.store_id and w.watched_at > ${now.toISOString()}::timestamptz - interval '1 day') < ${WATCH_PER_STORE_DAY}
          order by o2.read_at
          limit ${deps.perRun ?? WATCH_PER_RUN}
          for update of o2 skip locked
        )
        returning o.id, o.store_id, o.rival_id, o.address
      )
      select c.id, c.store_id, s.slug, c.rival_id, c.address, r.added_by
      from claimed c
      join commerce.stores s on s.id = c.store_id
      join commerce.market_rivals r on r.store_id = c.store_id and r.id = c.rival_id
    `,
  );
  const run: WatchRun = { read: 0, changed: 0, failed: 0, platform: { checked: 0, gone: 0, failed: 0 } };
  for (const o of due) {
    try {
      const store = await getStore(o.slug);
      if (!store || store.id !== o.store_id) continue;
      const read = await readOfferPage({ account: { id: o.added_by }, store }, { url: o.address }, deps);
      const offer = read.offers[0];
      if (!offer) {
        run.failed++;
        continue;
      }
      const kept = await keepOffer(o.store_id, o.rival_id, null, o.address, offer);
      run.read++;
      if (kept.changed) run.changed++;
    } catch (error) {
      run.failed++;
      // A page the site refuses or that cannot be read is a business outcome: it waits and goes old. Anything else is reported.
      if (!(error instanceof OwnerToolError)) report(error, "rivals.watch");
    }
  }
  // The other store platforms' prices (M4), in the same job: a few pages a run.
  try {
    run.platform = await watchPlatformRivalPrices(deps);
  } catch (error) {
    report(error, "rivals.platform_watch");
  }
  return run;
}

/** The most other platforms' prices the platform keeps. */
export const PLATFORM_RIVAL_PRICES_MAX = 60;

export type PlatformRivalProblem = "platform" | "plan" | "price" | "interval" | "fee" | "source" | "ours" | "full";

export class PlatformRivalError extends Error {
  constructor(readonly problem: PlatformRivalProblem) {
    super(problem);
  }
}

/** Another store platform's plan price as kept (D900 M4), with Kaizena Flow's own price for the plan it is held against, in its currency and interval. */
export type PlatformRivalPrice = {
  id: string;
  platform: string;
  plan: string;
  priceMinor: number;
  currency: string;
  interval: "month" | "year";
  feeBps: number | null;
  planId: string | null;
  planName: string | null;
  /** Kaizena Flow's active price for that plan in the same currency and interval; null when it has none to compare. */
  oursMinor: number | null;
  source: string;
  checkedOn: string;
  onPage: boolean | null;
  goneAt: string | null;
};

const PLATFORM_PRICE = z.object({
  id: col.uuid,
  platform: col.text,
  plan: col.text,
  price_minor: col.minor,
  currency: col.currency,
  interval: z.enum(["month", "year"]),
  fee_bps: col.minorOrNull,
  plan_id: col.textOrNull,
  plan_name: col.textOrNull,
  ours_minor: col.minorOrNull,
  source: col.text,
  checked_on: col.text,
  on_page: col.bool.nullable(),
  gone_at: col.textOrNull,
});

/** Every other platform's price kept, by platform and plan, each with Kaizena Flow's own price beside it. One read. */
export async function listPlatformRivalPrices(): Promise<PlatformRivalPrice[]> {
  const rows = await typedRows(
    PLATFORM_PRICE,
    sql`
      select r.id, r.platform, r.plan, r.price_minor, r.currency::text as currency, r.interval, r.fee_bps, r.plan_id::text as plan_id, p.name as plan_name,
        pp.amount_minor as ours_minor, r.source, r.checked_on::text as checked_on, r.on_page, r.gone_at::text as gone_at
      from commerce.platform_rival_prices r
      left join commerce.plans p on p.id = r.plan_id
      left join commerce.plan_prices pp on pp.plan_id = r.plan_id and pp.currency = r.currency and pp.interval = r.interval and pp.active
      order by lower(r.platform), r.price_minor, lower(r.plan)
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    plan: r.plan,
    priceMinor: r.price_minor,
    currency: r.currency,
    interval: r.interval,
    feeBps: r.fee_bps,
    planId: r.plan_id,
    planName: r.plan_name,
    oursMinor: r.ours_minor,
    source: r.source,
    checkedOn: r.checked_on,
    onPage: r.on_page,
    goneAt: r.gone_at,
  }));
}

/** Whether a page's text states the price, or null when the page could not be read (refused by its robots.txt, gone, too large). */
async function onItsPage(account: { id: string }, source: string, minor: number, currency: string, deps: ResearchDeps): Promise<boolean | null> {
  try {
    const page = await readWebPage({ account, store: null }, { url: source }, deps);
    return priceOnPage(`${page.title} ${page.description} ${page.text}`, minor, currency);
  } catch (error) {
    if (error instanceof OwnerToolError) return null;
    throw error;
  }
}

/**
 * Keeps another platform's plan price as a platform admin read it on that platform's own page (D900 M4): by platform, plan, currency and
 * interval, kept again in place when it is there. Code reads the page and says whether the price is on it (`priceOnPage()`); a page that
 * cannot be read keeps it unconfirmed. The caller is a platform admin (`platformAction()`).
 */
export async function keepPlatformRivalPrice(
  account: { id: string },
  input: { platform: string; plan: string; price: string; currency: string; interval: string; fee: string; ours: string; source: string },
  deps: ResearchDeps = {},
): Promise<{ id: string; onPage: boolean | null }> {
  const platform = input.platform.trim().replace(/\s+/g, " ");
  if (platform.length < 1 || platform.length > 80) throw new PlatformRivalError("platform");
  const plan = input.plan.trim().replace(/\s+/g, " ");
  if (plan.length < 1 || plan.length > 80) throw new PlatformRivalError("plan");
  const currency = input.currency.trim().toUpperCase();
  const minor = amountMinor(input.price.trim().replace(/\s/g, "").replace(",", "."), currency);
  if (minor === null || minor < 0) throw new PlatformRivalError("price");
  if (input.interval !== "month" && input.interval !== "year") throw new PlatformRivalError("interval");
  const feeText = input.fee.trim().replace(",", ".").replace(/%$/, "").trim();
  const fee = feeText === "" ? null : Number(feeText);
  if (fee !== null && (!Number.isFinite(fee) || fee < 0 || fee > 100)) throw new PlatformRivalError("fee");
  const source = input.source.trim();
  if (!normaliseSource(source) || !source.startsWith("https://") || source.length > 2000) throw new PlatformRivalError("source");
  const ours = input.ours.trim() || null;
  if (ours) {
    const plan = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.plans where id::text = ${ours}`);
    if (!plan) throw new PlatformRivalError("ours");
  }
  const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.platform_rival_prices`);
  const exists = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.platform_rival_prices where platform = ${platform} and plan = ${plan} and currency = ${currency} and interval = ${input.interval}`,
  );
  if (!exists && (count?.n ?? 0) >= PLATFORM_RIVAL_PRICES_MAX) throw new PlatformRivalError("full");
  const onPage = await onItsPage(account, source, minor, currency, deps);
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.platform_rival_prices (platform, plan, price_minor, currency, interval, fee_bps, plan_id, source, checked_on, on_page, added_by)
      values (${platform}, ${plan}, ${minor}, ${currency}, ${input.interval}, ${fee === null ? null : Math.round(fee * 100)}, ${ours}::uuid, ${source}, current_date, ${onPage},
        ${account.id}::uuid)
      on conflict (platform, plan, currency, interval) do update set
        price_minor = excluded.price_minor, fee_bps = excluded.fee_bps, plan_id = excluded.plan_id, source = excluded.source, checked_on = excluded.checked_on,
        on_page = excluded.on_page, gone_at = null, added_by = excluded.added_by
      returning id`,
  );
  if (!row) throw new Error("platform_rival_prices: the upsert returned no row");
  await audit(account.id, null, "platform.rival_price_kept", { price: row.id, platform, plan, currency, interval: input.interval, onPage });
  return { id: row.id, onPage };
}

/** Removes another platform's price; false when there is no such row. */
export async function removePlatformRivalPrice(account: { id: string }, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.platform_rival_prices where id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(account.id, null, "platform.rival_price_removed", { price: id });
  return true;
}

export type PlatformWatchRun = { checked: number; gone: number; failed: number };

/**
 * The other platforms' prices checked again (D900 M4): a few checked longer ago than `PLATFORM_WATCH_DAYS`, each page read as the admin who
 * kept it. Found on its page: checked today. A price that was on its page and is no longer: `gone_at`, for a person to check again (code
 * never guesses the new figure). A page that cannot be read waits `RIVAL_RETRY_DAYS`.
 */
export async function watchPlatformRivalPrices(deps: WatchDeps = {}): Promise<PlatformWatchRun> {
  const now = deps.now ?? new Date();
  const due = await typedRows(
    z.object({ id: col.uuid, source: col.text, price_minor: col.minor, currency: col.currency, on_page: col.bool.nullable(), added_by: col.uuid }),
    sql`
      update commerce.platform_rival_prices r set watched_at = ${now.toISOString()}::timestamptz
      where r.id in (
        select id from commerce.platform_rival_prices
        where added_by is not null and checked_on < (${now.toISOString()}::timestamptz - make_interval(days => ${PLATFORM_WATCH_DAYS}))::date
          and (watched_at is null or watched_at < ${now.toISOString()}::timestamptz - make_interval(days => ${RIVAL_RETRY_DAYS}))
        order by checked_on limit ${PLATFORM_WATCH_PER_RUN}
        for update skip locked
      )
      returning r.id, r.source, r.price_minor, r.currency::text as currency, r.on_page, r.added_by
    `,
  );
  const run: PlatformWatchRun = { checked: 0, gone: 0, failed: 0 };
  for (const r of due) {
    const found = await onItsPage({ id: r.added_by }, r.source, r.price_minor, r.currency, deps);
    if (found === null) {
      run.failed++;
      continue;
    }
    if (found) {
      await db().execute(sql`update commerce.platform_rival_prices set checked_on = current_date, on_page = true, gone_at = null where id = ${r.id}::uuid`);
      run.checked++;
      continue;
    }
    await db().execute(sql`
      update commerce.platform_rival_prices set on_page = false, gone_at = case when on_page or gone_at is not null then coalesce(gone_at, now()) else null end
      where id = ${r.id}::uuid
    `);
    if (r.on_page) run.gone++;
  }
  return run;
}

const OFFER_ROW = z.object({
  id: col.uuid,
  rival_id: col.uuid,
  rival_name: col.text,
  host: col.text,
  market: col.text,
  address: col.text,
  name: col.text,
  product_id: col.textOrNull,
  product_name: col.textOrNull,
  price_minor: col.minor,
  currency: col.currency,
  high_price_minor: col.minorOrNull,
  availability: col.text,
  shipping_minor: col.minorOrNull,
  shipping_currency: col.textOrNull,
  delivery_days_min: col.minorOrNull,
  delivery_days_max: col.minorOrNull,
  return_days: col.minorOrNull,
  read_at: col.text,
  previous: z.unknown(),
  changed_at: col.textOrNull,
  own_minor: col.minorOrNull,
  own_currency: col.textOrNull,
});

/** The state kept before the last change (`keepOffer()`'s `previous`), or null when there is none or it cannot be read. */
const PREVIOUS = z.object({
  priceMinor: z.number(),
  currency: z.string(),
  availability: z.string(),
  shippingMinor: z.number().nullable(),
  shippingCurrency: z.string().nullable(),
  returnDays: z.number().nullable(),
  readAt: z.string(),
});
const previousOf = (raw: unknown): (OfferState & { readAt: string }) | null => {
  const parsed = PREVIOUS.safeParse(raw);
  return parsed.success ? { ...parsed.data, currency: parsed.data.currency.trim(), shippingCurrency: parsed.data.shippingCurrency?.trim() ?? null } : null;
};

/**
 * Every offer kept of the store's rivals, each with the store's own price for the product it is held against in the rival's country: the
 * lowest of its variants' current prices there (`current_prices`, what shoppers are sold, VAT included), in the rival's currency when the
 * store has a price in it. One read.
 */
export async function rivalOffers(store: Pick<Store, "id">, locale = "en-GB"): Promise<KeptOffer[]> {
  const rows = await typedRows(
    OFFER_ROW,
    sql`
      select o.id, o.rival_id, r.name as rival_name, r.host, r.market_code::text as market, o.address, o.name, o.product_id::text as product_id,
        coalesce(t.title, p.handle) as product_name, o.price_minor, o.currency::text as currency, o.high_price_minor, o.availability, o.shipping_minor,
        o.shipping_currency::text as shipping_currency, o.delivery_days_min, o.delivery_days_max, o.return_days, o.read_at::text as read_at,
        o.previous, o.changed_at::text as changed_at, own.amount as own_minor, own.currency as own_currency
      from commerce.rival_offers o
      join commerce.market_rivals r on r.store_id = o.store_id and r.id = o.rival_id
      left join commerce.products p on p.store_id = o.store_id and p.id = o.product_id
      left join lateral (
        select tr.title from commerce.product_translations tr
        where tr.store_id = o.store_id and tr.product_id = o.product_id and btrim(tr.title) <> ''
        order by (tr.locale = ${locale}) desc, tr.locale limit 1
      ) t on true
      left join lateral (
        select min(cp.amount_minor) as amount, cp.currency::text as currency
        from commerce.current_prices cp join commerce.product_variants v on v.store_id = cp.store_id and v.id = cp.variant_id
        where cp.store_id = o.store_id and v.product_id = o.product_id and cp.market_code = r.market_code
        group by cp.currency order by (cp.currency = o.currency) desc limit 1
      ) own on true
      where o.store_id = ${store.id}::uuid
      order by r.market_code, lower(r.name), o.read_at desc
    `,
  );
  return rows.map((r) => {
    const own: OwnPrice | null = r.own_minor !== null && r.own_currency ? { priceMinor: r.own_minor, currency: r.own_currency.trim() } : null;
    return {
      id: r.id,
      rivalId: r.rival_id,
      rivalName: r.rival_name,
      host: r.host,
      market: r.market.trim(),
      address: r.address,
      name: r.name,
      productId: r.product_id,
      productName: r.product_name ?? r.name,
      priceMinor: r.price_minor,
      currency: r.currency,
      highPriceMinor: r.high_price_minor,
      availability: r.availability,
      shippingMinor: r.shipping_minor,
      shippingCurrency: r.shipping_currency?.trim() ?? null,
      deliveryDaysMin: r.delivery_days_min,
      deliveryDaysMax: r.delivery_days_max,
      returnDays: r.return_days,
      readAt: r.read_at,
      previous: previousOf(r.previous),
      changedAt: r.changed_at,
      own: r.product_id ? own : null,
    };
  });
}

/** The store's products a rival's page may be held against: not archived, demo products left out, by title, at most `limit`. */
export async function rivalProductChoices(store: Pick<Store, "id" | "localization">, limit = 300): Promise<{ handle: string; title: string }[]> {
  const main = store.localization.locales[0];
  const rows = await typedRows(
    z.object({ handle: col.text, title: col.text }),
    sql`
      select p.handle, coalesce(nullif(btrim(t.title), ''), p.handle) as title
      from commerce.products p
      left join commerce.product_translations t on t.store_id = p.store_id and t.product_id = p.id and t.locale = ${main}
      where p.store_id = ${store.id}::uuid and p.status <> 'archived' and not ${isDemoProduct(sql`p`)}
      order by lower(coalesce(nullif(btrim(t.title), ''), p.handle)), p.handle
      limit ${limit}
    `,
  );
  return rows;
}
