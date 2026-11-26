import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import {
  DEMAND_TERMS,
  MARKET_TERMS,
  MIN_MISSES,
  marketFindings,
  type MarketCheckFacts,
  type MarketFacts,
  type MarketFinding,
} from "@/lib/market-check";
import { SITE_WINDOW_DAYS, type RivalSiteFacts } from "@/lib/market-rivals";
import { featureOn } from "@/lib/store-features";
import { countryName } from "@/lib/vat-text";

import { geoReport } from "./analytics-geo-data";
import { searchesByMarket } from "./analytics-search-data";
import { marketTraffic, type Coverage } from "./analytics-traffic-data";
import { isDemoProduct } from "./demo-content";
import { listRivals, rivalOffers, rivalSites, type KeptOffer, type Rival } from "./market-rivals";
import { owned } from "./owned";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The market check's first step (D900 M1, `docs/market-check.md` 3, `docs/analytics.md` "Markets"): each country's facts, read from what
 * the store already keeps, and the findings `marketFindings()` works out from them. Nothing is kept and no model is called.
 *
 * - Visits and conversion are the Traffic page's countries (`marketTraffic()`), orders, revenue and the average order its sales by country
 *   (`geoReport()`), searches the Traffic page's searches by the country they were made in (`searchesByMarket()`).
 * - Products with no price, and without a name in a country's own language, are counted here: active products, demo products left out.
 * - Kaizena Flow's own store (`house`) sells plans through Stripe, not goods: orders and prices do not apply to it and are not read.
 */

export type MarketCheck = MarketCheckFacts & {
  findings: MarketFinding[];
  /** The main currency of every amount, without VAT. */
  currency: string;
  /** The store's main language: a country whose own is another is checked for text in it. */
  mainLocale: string;
  /** What the visits cover (D152): while counting is off no country has visits or a conversion. */
  coverage: Coverage;
  /** What the searches cover: none of the period's days still kept, or the period cut to the 90 days kept. */
  searchesEmpty: boolean;
  searchesClamped: boolean;
  /** The first day whose searches are still kept (`YYYY-MM-DD`, the store's). */
  searchesFrom: string;
  /** Orders and prices apply: the store has a shop and is not Kaizena Flow's own store. */
  sells: boolean;
  house: boolean;
  /** The store's rivals (every store's, D905) and the offers read of them (D900 M2; none where prices do not apply). */
  rivals: Rival[];
  offers: KeptOffer[];
  /** What changed on the rivals' sites (D905). */
  sites: RivalSiteFacts[];
};

const PER_LOCALE = z.object({ locale: col.text, n: col.int });
const PER_MARKET = z.object({ market: col.text, n: col.int });

/** Active products of the store, demo products left out. */
const ACTIVE = (store: Store) => sql`p.store_id = ${store.id}::uuid and p.status = 'active' and not ${isDemoProduct(sql`p`)}`;

/** Active products of which no variant has a price kept in the country and that are not switched off there as a whole, per country. */
async function unpricedByMarket(store: Store, codes: readonly string[]): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const rows = await typedRows(
    PER_MARKET,
    sql`
      select m.code as market, count(*)::int as n
      from unnest(${`{${codes.join(",")}}`}::text[]) as m(code)
      join commerce.products p on ${ACTIVE(store)}
      where not exists (
          select 1 from commerce.product_variants v
          join commerce.kept_prices k on k.store_id = v.store_id and k.variant_id = v.id and k.market_code = m.code
          where v.store_id = p.store_id and v.product_id = p.id
        )
        and not exists (
          select 1 from commerce.market_availability a
          where a.store_id = p.store_id and a.product_id = p.id and a.variant_id is null and a.market_code = m.code
        )
      group by 1
    `,
  );
  return new Map(rows.map((r) => [r.market, r.n]));
}

/** Active products with no name in a language (no translation, or an empty title: shoppers read the main language's), per language. */
async function untranslatedByLocale(store: Store, locales: readonly string[]): Promise<Map<string, number>> {
  if (locales.length === 0) return new Map();
  const rows = await typedRows(
    PER_LOCALE,
    sql`
      select l.locale, count(*)::int as n
      from unnest(${`{${locales.join(",")}}`}::text[]) as l(locale)
      join commerce.products p on ${ACTIVE(store)}
      where not exists (
        select 1 from commerce.product_translations t
        where t.store_id = p.store_id and t.product_id = p.id and t.locale = l.locale and btrim(t.title) <> ''
      )
      group by 1
    `,
  );
  return new Map(rows.map((r) => [r.locale, r.n]));
}

async function activeProducts(store: Store): Promise<number> {
  const [row] = await typedRows(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.products p where ${ACTIVE(store)}`);
  return row?.n ?? 0;
}

/**
 * The pages and articles the store first published within `SITE_WINDOW_DAYS` (D905), held against what its rivals' sites added; for
 * Kaizena Flow's own store, the platform site's too (`store_id` null).
 */
async function publishedSince(store: Pick<Store, "id" | "house">, now: Date): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.pages
      where (${owned(store.id)}${store.house ? sql` or ${owned(null)}` : sql``}) and type in ('page', 'article') and published_at is not null
        and first_published_at > ${now.toISOString()}::timestamptz - make_interval(days => ${SITE_WINDOW_DAYS})`,
  );
  return row?.n ?? 0;
}

/**
 * The market check for a period. `locale` names the countries (an admin's language: `en-GB`, `nb-NO`); `now` decides which days of visits
 * and searches are covered. Reads run side by side; none reads more than a row per country (and per missed term).
 */
export async function marketCheck(store: Store, period: AnalyticsPeriod, options: { now?: Date; locale?: string } = {}): Promise<MarketCheck> {
  const now = options.now ?? new Date();
  const locale = options.locale ?? "en-GB";
  const house = store.house;
  const sells = !house && featureOn(store, "shop");
  const mainLocale = store.localization.locales[0];
  // One row per country the store sells to, whatever its language and currency views: the first view's own language is the country's.
  const sold = new Map<string, string>();
  for (const m of store.markets) if (!sold.has(m.code)) sold.set(m.code, m.ownLocale);
  const otherLocales = [...new Set([...sold.values()].filter((l) => l !== mainLocale))];

  const [traffic, geo, searches, unpriced, untranslated, products, rivals, offers, sites, published] = await Promise.all([
    marketTraffic(store, period, now),
    sells ? geoReport(store, period) : null,
    searchesByMarket(store, period, { perMarket: MARKET_TERMS, minMisses: MIN_MISSES, demandTerms: DEMAND_TERMS }, now),
    sells ? unpricedByMarket(store, [...sold.keys()]) : new Map<string, number>(),
    house ? new Map<string, number>() : untranslatedByLocale(store, otherLocales),
    house ? 0 : activeProducts(store),
    // Rivals are every store's (D905): a site needs no shop. Their offers need products.
    listRivals(store.id),
    // Product names in the store's main language, the one its products are always written in.
    sells ? rivalOffers(store, mainLocale) : [],
    rivalSites(store.id, now),
    publishedSince(store, now),
  ]);

  const visitRows = new Map(traffic.byMarket.filter((r) => r.key !== "front_door").map((r) => [r.key, r]));
  const geoRows = new Map((geo?.countries ?? []).map((r) => [r.code, r]));
  const codes = new Set<string>([...sold.keys(), ...visitRows.keys(), ...geoRows.keys(), ...searches.markets.keys()]);
  const counted = traffic.coverage.counting && traffic.coverage.days > 0;

  const markets: MarketFacts[] = [...codes].map((code) => {
    const visit = visitRows.get(code);
    const sale = geoRows.get(code);
    const search = searches.markets.get(code);
    const own = sold.get(code) ?? null;
    const other = own !== null && own !== mainLocale && !house ? own : null;
    return {
      code,
      name: countryName(code, locale),
      sells: sold.has(code),
      visits: counted ? (visit?.sessions ?? 0) : null,
      visitOrders: counted ? (visit?.orders ?? 0) : null,
      orders: sells ? (sale?.orders ?? 0) : null,
      revenueMinor: sells ? (sale?.revenueMinor ?? 0) : null,
      searches: searches.empty ? null : (search?.searches ?? 0),
      misses: searches.empty ? null : (search?.misses ?? 0),
      missedTerms: search?.terms ?? [],
      unpriced: sells && sold.has(code) ? (unpriced.get(code) ?? 0) : null,
      locale: other,
      untranslated: other ? (untranslated.get(other) ?? 0) : null,
    };
  });
  // The countries the store sells to first, then by visits, orders and searches; ties by name.
  markets.sort(
    (a, b) =>
      Number(b.sells) - Number(a.sells) ||
      (b.visits ?? 0) - (a.visits ?? 0) ||
      (b.orders ?? 0) - (a.orders ?? 0) ||
      (b.searches ?? 0) - (a.searches ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const facts: MarketCheckFacts = { markets, products, demand: searches.demand, rivalOffers: offers, rivalSites: sites, published };
  return {
    ...facts,
    findings: marketFindings(facts, now),
    currency: mainCurrency(store),
    mainLocale,
    coverage: traffic.coverage,
    searchesEmpty: searches.empty,
    searchesClamped: searches.clamped,
    searchesFrom: searches.availableFrom,
    sells,
    house,
    rivals,
    offers,
    sites,
  };
}
