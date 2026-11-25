import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { OFFERS_PER_RIVAL, onRivalSite, RIVALS_PER_MARKET, rivalHost, type OwnPrice, type RivalOfferFacts } from "@/lib/market-rivals";
import type { PageOffer } from "@/lib/offer-data";

import { audit } from "./auth";
import { isDemoProduct } from "./demo-content";
import { readOfferPage, type ResearchActor, type ResearchDeps } from "./research";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's rivals (D900 M2, `docs/market-check.md` 4), the only writer of `commerce.market_rivals` and `commerce.rival_offers`. A rival
 * is added by a person on Analytics → Markets, so every rival is one the owner recognises; an offer is read from the rival's own product
 * page through `readOfferPage()` (robots.txt first, the page's JSON-LD only, kept as a research source) and held against one of the store's
 * products. Its price is never read off a page's words, and nothing here changes what shoppers see.
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
  shippingMinor: number | null;
  shippingCurrency: string | null;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  returnDays: number | null;
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
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.rival_offers (store_id, rival_id, product_id, address, name, price_minor, currency, high_price_minor, availability,
        shipping_minor, shipping_currency, delivery_days_min, delivery_days_max, return_days, read_at)
      values (${actor.store.id}::uuid, ${rival.id}::uuid, ${productId}::uuid, ${input.page}, ${offer.name.slice(0, 300)}, ${offer.priceMinor}, ${offer.currency},
        ${offer.highPriceMinor}, ${offer.availability}, ${offer.shippingMinor}, ${offer.shippingCurrency}, ${offer.deliveryDaysMin}, ${offer.deliveryDaysMax},
        ${offer.returnDays}, now())
      on conflict (rival_id, address) do update set
        product_id = coalesce(excluded.product_id, commerce.rival_offers.product_id), name = excluded.name, price_minor = excluded.price_minor,
        currency = excluded.currency, high_price_minor = excluded.high_price_minor, availability = excluded.availability,
        shipping_minor = excluded.shipping_minor, shipping_currency = excluded.shipping_currency, delivery_days_min = excluded.delivery_days_min,
        delivery_days_max = excluded.delivery_days_max, return_days = excluded.return_days, read_at = excluded.read_at
      returning id`,
  );
  return { offer, kept: row?.id ?? "" };
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
  own_minor: col.minorOrNull,
  own_currency: col.textOrNull,
});

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
        own.amount as own_minor, own.currency as own_currency
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
