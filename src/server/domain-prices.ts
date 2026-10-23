import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { billingCurrency, domainPrice, type DomainPricing, type EurRates } from "@/lib/domain-prices";

import type { Account } from "./auth";
import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * The rules that turn a registrar's price into a store's (D315 decision 3): `commerce.domain_pricing` per currency, the latest ECB rates,
 * and which currency a store pays in. The arithmetic is `domainPrice()`; this module only reads and saves its inputs.
 */

export async function domainPricingRows(): Promise<DomainPricing[]> {
  const rows = await db().execute<Row>(sql`select currency, margin_bps, minimum_minor, round_minor from commerce.domain_pricing order by currency`);
  return rows.map((r) => ({ currency: String(r.currency).trim(), marginBps: Number(r.margin_bps), minimumMinor: Number(r.minimum_minor), roundMinor: Number(r.round_minor) }));
}

/** The latest ECB rate of each currency (units per 1 EUR), and the day it is from. */
export async function latestEurRates(): Promise<{ rates: EurRates; day: string | null }> {
  const rows = await db().execute<Row>(sql`
    select distinct on (currency) currency::text as currency, rate::text as rate, rate_date::text as day
      from commerce.ecb_reference_rates
     order by currency, rate_date desc
  `);
  const rates: Record<string, string> = {};
  let day: string | null = null;
  for (const r of rows) {
    rates[String(r.currency).trim()] = String(r.rate);
    if (!day || String(r.day) > day) day = String(r.day).slice(0, 10);
  }
  return { rates, day };
}

/** The currency a store pays Kaizena Flow in for domains: its plan's, else its own country's, among the priced currencies. */
export async function storeDomainCurrency(storeId: string, priced: readonly string[]): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select (select pp.currency from commerce.store_billing b join commerce.plan_prices pp on pp.id = b.price_id where b.store_id = s.id) as plan_currency,
           (select m.currency from commerce.markets m where m.store_id = s.id and m.code = commerce.home_market(s.id) limit 1) as home_currency
      from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return billingCurrency(row?.plan_currency ? String(row.plan_currency).trim() : null, row?.home_currency ? String(row.home_currency).trim() : null, priced);
}

export type PriceContext = { pricing: DomainPricing; rates: EurRates };

/** What prices are worked out with, in one currency; null when the currency is not sold in or has no rate. */
export async function priceContext(currency: string | null): Promise<PriceContext | null> {
  if (!currency) return null;
  const [rows, { rates }] = await Promise.all([domainPricingRows(), latestEurRates()]);
  const pricing = rows.find((r) => r.currency === currency);
  if (!pricing) return null;
  if (currency !== "EUR" && !rates[currency]) return null;
  return { pricing, rates };
}

/** Our price for a registrar's price in a context. */
export const priceIn = (ctx: PriceContext, cost: number | string, costCurrency: string, years = 1): number | null =>
  domainPrice(cost, costCurrency, years, ctx.pricing, ctx.rates);

const PRICING_LIMITS = { marginBps: [0, 50_000], minimumMinor: [0, 100_000_000], roundMinor: [1, 100_000] } as const;

/** Saves a currency's pricing (platform admins, `/admin/platform/domains`), audited. */
export async function saveDomainPricing(account: Account, input: DomainPricing): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const problems: string[] = [];
  if (!/^[A-Z]{3}$/.test(input.currency)) problems.push("Choose a currency.");
  for (const [key, [min, max]] of Object.entries(PRICING_LIMITS) as [keyof typeof PRICING_LIMITS, readonly [number, number]][]) {
    const v = input[key];
    if (!Number.isInteger(v) || v < min || v > max) problems.push(`${key} must be a whole number from ${min} to ${max}.`);
  }
  if (problems.length > 0) return { ok: false, problems };
  await db().execute(sql`
    insert into commerce.domain_pricing (currency, margin_bps, minimum_minor, round_minor, updated_by, updated_at)
    values (${input.currency}, ${input.marginBps}, ${input.minimumMinor}, ${input.roundMinor}, ${account.id}::uuid, now())
    on conflict (currency) do update set margin_bps = excluded.margin_bps, minimum_minor = excluded.minimum_minor,
      round_minor = excluded.round_minor, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, null, "platform.domain_pricing_saved", { currency: input.currency, margin_bps: input.marginBps, minimum_minor: input.minimumMinor, round_minor: input.roundMinor });
  return { ok: true };
}
