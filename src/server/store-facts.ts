import "server-only";

import { sql } from "drizzle-orm";

import { z } from "zod";

import { db } from "@/db/client";
import type { Market } from "@/lib/markets";
import { rememberSiteStore } from "@/lib/paths";
import { privateDecision } from "@/lib/private-mode";
import { storePathOf, type StoreAddress } from "@/lib/store-address";
import { normaliseFeatures, type FeatureId } from "@/lib/store-features";
import { localized } from "@/lib/store-localized";

import { forgetRemembered, remembered } from "./short-memory";
import { col, typedRow } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * A store's few-second facts, as the proxy reads them (bloat review step 2.20): moved here from `redirect-resolve.ts`, which re-exports
 * them, so the proxy's private-mode gate and the address decisions read the database client, the short memory and pure src/lib code only.
 */

export type StoreFacts = {
  id: string;
  slug: string;
  mainMarket: string;
  address: StoreAddress | null;
  /** The store's `private_version` while it is private (D339), else null: a store template or demo store never is. */
  privateVersion: number | null;
} | null;

/** How long an instance keeps a store's facts: a switch of Several countries, languages or currencies reaches other instances within it (`forgetStoreFacts()` for this one). */
export const FACTS_MS = 10_000;

/**
 * The one statement both few-second reads of an open store run (`storeFactsOf()` for the proxy, `visitStoreOf()` for the visit beacons):
 * the columns `localized()` needs as `getStore()` selects them, the private-mode version, and what the beacons read (visit counting,
 * company recognition (D890), the store's zone, never null in the table, and whether its pages are Kaizena Flow's own site, D484).
 */
const factsStatement = (slug: string) => sql`
  select s.id, s.slug, s.features, s.locales, s.house, s.language_rule, s.currency_follows_language, s.language_currencies,
    s.visit_counting, s.company_recognition, s.time_zone,
    (s.house and coalesce((select p.site_from_store from commerce.platform_settings p), false)) as on_site,
    case when s.private_mode and not (s.is_template or s.starter) then s.private_version end as private_version,
    (select coalesce(json_agg(json_build_object('currency', c.currency, 'rate', c.rate, 'roundTo', c.round_to) order by c.position, c.currency), '[]')
       from commerce.store_currencies c where c.store_id = s.id) as currencies,
    (select coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale)
       order by (m.code = s.country) desc nulls last, m.created_at, m.code), '[]')
       from commerce.markets m where m.store_id = s.id and m.active) as markets,
    (select coalesce(json_agg(json_build_object('code', a.code, 'currency', a.currency, 'defaultLocale', a.default_locale)
       order by a.active desc, (a.code = s.country) desc nulls last, a.created_at, a.code), '[]')
       from commerce.markets a where a.store_id = s.id) as all_markets
  from commerce.stores s where s.slug = ${slug} and s.status = 'active' and not s.workspace
`;

/**
 * What the proxy needs of a store: its id, its main market's address and the shape of its addresses (D181), read as `getStore()` reads them
 * (`localized()`); null for a store that is not open or has no market. Remembered for a few seconds (the proxy does not use `'use cache'`), so a
 * visitor's request reads the database at most once per store and instance in `FACTS_MS`.
 */
export async function storeFactsOf(slug: string): Promise<StoreFacts> {
  return remembered(factsKey(slug), async () => {
    const [row] = await db().execute<Row>(factsStatement(slug));
    if (!row) return null;
    const { markets, address } = localized(row);
    const main = markets[0];
    const privateVersion = row.private_version === null || row.private_version === undefined ? null : Number(row.private_version);
    return main ? { id: String(row.id), slug: String(row.slug), mainMarket: main.slug, address, privateVersion } : null;
  }, FACTS_MS);
}

const factsKey = (slug: string) => `${slug}|facts`;

/**
 * What the visit beacons need of an open store: `getOpenStore()`'s fields they read. `features` is the store's features as `getStore()`
 * normalises them (the recommendations' beacon counts only while the shop is on), and `onSite` whether its pages are Kaizena Flow's own
 * site (D484), remembered for `storeOrigins()` as `getStore()` remembers it.
 */
export type VisitStore = {
  id: string;
  slug: string;
  visitCounting: boolean;
  /** Which companies visited (D890): a counted page view's address is looked up after the beacon is answered. */
  companyRecognition: boolean;
  timeZone: string;
  allMarkets: Market[];
  address: StoreAddress | null;
  features: FeatureId[];
  onSite: boolean;
};

const VISIT_ROW = z.object({ id: col.uuid, slug: col.text, visit_counting: col.bool, company_recognition: col.bool, time_zone: col.text, on_site: col.bool }).loose();

/**
 * What the visit beacons need of an open store, read without a cached function so /api/visit lists no server reference; remembered for
 * FACTS_MS per instance, the freshness the proxy has (bloat review step 2.24).
 */
export async function visitStoreOf(slug: string): Promise<VisitStore | null> {
  const store = await remembered(visitKey(slug), async (): Promise<VisitStore | null> => {
    const row = await typedRow(VISIT_ROW, factsStatement(slug));
    if (!row) return null;
    const { allMarkets, address } = localized(row);
    return {
      id: row.id,
      slug: row.slug,
      visitCounting: row.visit_counting,
      companyRecognition: row.company_recognition,
      timeZone: row.time_zone,
      allMarkets,
      address,
      features: normaliseFeatures(Array.isArray(row.features) ? (row.features as unknown[]).map(String) : []),
      onSite: row.on_site,
    };
  }, FACTS_MS);
  // As `getStore()` does: Kaizena Flow's own store while its site is served from it is on Kaizena Flow's own host (`storeOrigins()`).
  if (store) rememberSiteStore(store.slug, store.onSite);
  return store;
}

const visitKey = (slug: string) => `${slug}|visit`;

/** Forgets this instance's visit facts of a store (other instances within `FACTS_MS`). */
export function forgetVisitStore(slug: string): void {
  forgetRemembered(visitKey(slug));
}

/** Forgets this instance's facts of a store, after a change to its countries, languages or currencies (other instances within `FACTS_MS`). */
export function forgetStoreFacts(slug: string): void {
  forgetRemembered(factsKey(slug));
  forgetVisitStore(slug);
}

/**
 * What the proxy needs to keep a private store's pages from a visitor without a pass (D339): the store's id and version and where its landing
 * page is for this request, on the path as served; null for a store that is not private, and for the landing page itself and the pages of
 * what was already sold (`privateDecision()`). Read from the same few-second facts as the address's decisions, never per request.
 */
export async function privateGate(served: string, hostStore: string | null): Promise<{ storeId: string; version: number; landing: string } | null> {
  const request = storePathOf(served, hostStore);
  if (!request) return null;
  const facts = await storeFactsOf(request.store);
  if (!facts || facts.privateVersion === null) return null;
  const decision = privateDecision({ store: request.store, hostBased: request.hostBased, parts: request.parts, mainMarket: facts.mainMarket });
  return "open" in decision ? null : { storeId: facts.id, version: facts.privateVersion, landing: decision.landing };
}

/** The first market of a store as an address (the country's own view), for the redirect of an address with no country. */
export async function mainMarketOf(storeSlug: string): Promise<string | null> {
  return (await storeFactsOf(storeSlug))?.mainMarket ?? null;
}
