import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { canConvert, toRates, type StoreCurrency } from "@/lib/currency";
import { derivedPrice, ruleProblem, type MarketPriceRule, type PriceBasis, type RulePreview } from "@/lib/market-prices";

import { audit } from "./auth";

/**
 * Market price rules (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2): the only writer of `commerce.market_price_rules` and of derived prices.
 * A ruled market's price of a variant is worked out by `derivedPrice()` from its price in the base market and written through `commerce.set_price`
 * (so the 30-day reference stays genuine), marked `prices.derived`; a price an owner typed there is fixed and never touched. Prices are derived again
 * after a product's save (`saveProduct()` calls `deriveForProducts()` in its transaction), when a rule is saved, and when the store's rates change.
 * Gift cards (face values) and bundles priced from their components (D322) are left alone.
 */

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

const asRule = (r: Row): MarketPriceRule => ({
  market: String(r.market_code),
  base: String(r.base_market),
  percentBps: Number(r.percent_bps),
  basis: (r.basis === "gross" ? "gross" : "net") as PriceBasis,
  roundToMinor: Number(r.round_to_minor),
  endingMinor: r.ending_minor === null || r.ending_minor === undefined ? null : Number(r.ending_minor),
});

/** The store's rules, by market. */
export async function marketPriceRules(storeId: string, runner: Runner = db()): Promise<MarketPriceRule[]> {
  const rows = await runner.execute<Row>(sql`
    select market_code, base_market, percent_bps, basis, round_to_minor, ending_minor
    from commerce.market_price_rules where store_id = ${storeId}::uuid order by market_code
  `);
  return rows.map(asRule);
}

/** How many current prices in each market are a rule's. */
export async function derivedCounts(storeId: string): Promise<Map<string, number>> {
  const rows = await db().execute<Row>(sql`
    select market_code, count(*)::int as n from commerce.prices
    where store_id = ${storeId}::uuid and valid_to is null and derived group by market_code
  `);
  return new Map(rows.map((r) => [String(r.market_code), Number(r.n)]));
}

async function ratesOf(storeId: string, runner: Runner) {
  const rows = await runner.execute<Row>(sql`select currency, rate, round_to from commerce.store_currencies where store_id = ${storeId}::uuid`);
  return toRates(rows.map((r): StoreCurrency => ({ currency: String(r.currency).trim(), rate: r.rate === null ? null : Number(r.rate), roundTo: Number(r.round_to) })));
}

/** Whether a rule can convert between its two countries' currencies: the same currency, or both with a rate. */
function convertible(base: string, market: string, rates: Awaited<ReturnType<typeof ratesOf>>): boolean {
  return base === market || canConvert(base, market, rates);
}

/**
 * Why a rule cannot work out any price, in the owner's words, or null: a currency of the two countries with no rate (the sentence names it, and the
 * Countries page shows it in the account's language).
 */
export async function rateProblem(storeId: string, rule: Pick<MarketPriceRule, "market" | "base">, runner: Runner = db()): Promise<string | null> {
  const rates = await ratesOf(storeId, runner);
  const currencies = await currenciesOf(runner, storeId);
  const base = currencies.get(rule.base);
  const market = currencies.get(rule.market);
  if (!base || !market || convertible(base, market, rates)) return null;
  const missing = [base, market].find((c) => !canConvert(c, "EUR", rates)) ?? market;
  return `${missing} has no rate under Languages and currencies, so no prices can be worked out into or from it.`;
}

/** One variant's facts for a rule, as the database has them now. */
type Facts = { variantId: string; baseMinor: number | null; baseVat: number; vat: number; current: number | null; derived: boolean };

/** A rule's work for some variants: the prices it writes and the derived ones it ends (no base price, no rate). */
export type Derivation = { variantId: string; amountMinor: number | null; before: number | null };

/** What a rule would write for the variants whose price in its market is not fixed: only those that change. */
export function planDerivations(rule: MarketPriceRule, facts: readonly Facts[], currencies: { base: string; market: string }, rates: Awaited<ReturnType<typeof ratesOf>>): Derivation[] {
  const out: Derivation[] = [];
  for (const f of facts) {
    if (f.current !== null && !f.derived) continue;
    const amount =
      f.baseMinor === null
        ? null
        : derivedPrice(rule, { baseMinor: f.baseMinor, baseCurrency: currencies.base, baseVatPercent: f.baseVat, currency: currencies.market, vatPercent: f.vat, rates });
    if (amount === f.current) continue;
    out.push({ variantId: f.variantId, amountMinor: amount, before: f.current });
  }
  return out;
}

async function factsFor(runner: Runner, storeId: string, rule: MarketPriceRule, productIds: readonly string[] | null): Promise<Facts[]> {
  const rows = await runner.execute<Row>(sql`
    select v.id as variant_id, base.amount_minor as base_minor,
           commerce.vat_rate(${rule.base}, p.vat_category) as base_vat, commerce.vat_rate(${rule.market}, p.vat_category) as vat,
           cur.amount_minor as current_minor, coalesce(cur.derived, false) as derived
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.prices base on base.variant_id = v.id and base.market_code = ${rule.base} and base.valid_to is null
    left join commerce.prices cur on cur.variant_id = v.id and cur.market_code = ${rule.market} and cur.valid_to is null
    where v.store_id = ${storeId}::uuid
      and p.kind <> 'gift_card' and not (p.kind = 'bundle' and p.bundle_pricing = 'computed')
      ${productIds ? sql`and v.product_id = any(${`{${productIds.join(",")}}`}::uuid[])` : sql``}
  `);
  return rows.map((r) => ({
    variantId: String(r.variant_id),
    baseMinor: r.base_minor === null ? null : Number(r.base_minor),
    baseVat: Number(r.base_vat ?? 0),
    vat: Number(r.vat ?? 0),
    current: r.current_minor === null ? null : Number(r.current_minor),
    derived: Boolean(r.derived),
  }));
}

/** Writes a rule's derivations: new prices through `commerce.set_price`, marked as the rule's, and derived prices with nothing to stand on ended. */
async function write(runner: Runner, market: string, work: readonly Derivation[]) {
  const set = work.filter((w) => w.amountMinor !== null).map((w, n) => ({ n, variant_id: w.variantId, amount_minor: w.amountMinor }));
  const ended = work.filter((w) => w.amountMinor === null).map((w) => w.variantId);
  if (set.length > 0) {
    await runner.execute(sql`
      select commerce.set_price(r.variant_id, ${market}, r.amount_minor)
      from jsonb_to_recordset(${JSON.stringify(set)}::jsonb) as r(n integer, variant_id uuid, amount_minor bigint)
      order by r.n
    `);
    await runner.execute(sql`
      update commerce.prices set derived = true
      where market_code = ${market} and valid_to is null and not derived
        and variant_id = any(${`{${set.map((s) => s.variant_id).join(",")}}`}::uuid[])
    `);
  }
  if (ended.length > 0) {
    await runner.execute(sql`
      update commerce.prices set valid_to = now()
      where market_code = ${market} and valid_to is null and derived and variant_id = any(${`{${ended.join(",")}}`}::uuid[])
    `);
  }
}

/** The markets' own currencies. */
async function currenciesOf(runner: Runner, storeId: string): Promise<Map<string, string>> {
  const rows = await runner.execute<Row>(sql`select code, currency from commerce.markets where store_id = ${storeId}::uuid`);
  return new Map(rows.map((r) => [String(r.code), String(r.currency).trim()]));
}

/**
 * Derives the prices of the store's ruled markets again, for some products (a save) or all of them (a rule or the rates changed), in the caller's
 * transaction. Returns how many prices it wrote and ended.
 */
export async function deriveForProducts(runner: Runner, storeId: string, scope: { productIds?: readonly string[]; markets?: readonly string[] } = {}): Promise<{ written: number; ended: number }> {
  const rules = (await marketPriceRules(storeId, runner)).filter((r) => !scope.markets || scope.markets.includes(r.market));
  if (rules.length === 0) return { written: 0, ended: 0 };
  const rates = await ratesOf(storeId, runner);
  const currencies = await currenciesOf(runner, storeId);
  let written = 0;
  let ended = 0;
  for (const rule of rules) {
    const base = currencies.get(rule.base);
    const market = currencies.get(rule.market);
    // A rate taken away leaves the rule's prices as they were (never ended for want of a rate): the next rate works them out again.
    if (!base || !market || !convertible(base, market, rates)) continue;
    const work = planDerivations(rule, await factsFor(runner, storeId, rule, scope.productIds ?? null), { base, market }, rates);
    await write(runner, rule.market, work);
    written += work.filter((w) => w.amountMinor !== null).length;
    ended += work.filter((w) => w.amountMinor === null).length;
  }
  return { written, ended };
}

/**
 * Puts the given products' prices in ruled markets back under the rule, as emptying the editor's field does: a price typed by hand there is
 * marked the rule's and worked out again from the base (through `commerce.set_price`, so the 30-day reference stays genuine). For the Dream
 * Factory (D409), whose products are priced in the home country only and whose other countries are the rules'.
 */
export async function backToRule(storeId: string, productIds: readonly string[]): Promise<{ written: number; ended: number }> {
  const markets = (await marketPriceRules(storeId)).map((r) => r.market);
  if (markets.length === 0 || productIds.length === 0) return { written: 0, ended: 0 };
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.prices p set derived = true
      from commerce.product_variants v
      where v.id = p.variant_id and v.store_id = ${storeId}::uuid and v.product_id = any(${`{${productIds.join(",")}}`}::uuid[])
        and p.market_code = any(${`{${markets.join(",")}}`}::text[]) and p.valid_to is null and not p.derived
    `);
    return deriveForProducts(tx, storeId, { productIds });
  });
}

export type { RulePreview };

/** What a rule as typed would make of five of the store's products' prices, before it is saved. */
export async function previewRule(storeId: string, rule: MarketPriceRule, locale: string): Promise<RulePreview[]> {
  const rates = await ratesOf(storeId, db());
  const currencies = await currenciesOf(db(), storeId);
  const base = currencies.get(rule.base);
  const market = currencies.get(rule.market);
  if (!base || !market) return [];
  const rows = await db().execute<Row>(sql`
    select v.id as variant_id, v.sku, coalesce(t.title, p.handle) as title, base.amount_minor as base_minor,
           commerce.vat_rate(${rule.base}, p.vat_category) as base_vat, commerce.vat_rate(${rule.market}, p.vat_category) as vat,
           cur.amount_minor as current_minor, coalesce(cur.derived, false) as derived
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    left join commerce.product_translations t on t.product_id = p.id and t.locale = ${locale}
    join commerce.prices base on base.variant_id = v.id and base.market_code = ${rule.base} and base.valid_to is null
    left join commerce.prices cur on cur.variant_id = v.id and cur.market_code = ${rule.market} and cur.valid_to is null
    where v.store_id = ${storeId}::uuid and v.active and p.kind <> 'gift_card' and not (p.kind = 'bundle' and p.bundle_pricing = 'computed')
    order by p.updated_at desc, v.sku limit 5
  `);
  return rows.map((r) => {
    const current = r.current_minor === null ? null : Number(r.current_minor);
    const fixed = current !== null && !r.derived;
    return {
      variantId: String(r.variant_id),
      title: String(r.title),
      sku: String(r.sku),
      base: Number(r.base_minor),
      before: current,
      after: fixed
        ? current
        : derivedPrice(rule, { baseMinor: Number(r.base_minor), baseCurrency: base, baseVatPercent: Number(r.base_vat ?? 0), currency: market, vatPercent: Number(r.vat ?? 0), rates }),
    };
  });
}

export type RuleResult = { ok: true; written: number; ended: number } | { ok: false; problem: string };

/**
 * Saves a market's rule and derives its prices at once, in one transaction; the markets must be the store's. Audited with the rule and counts.
 */
export async function saveMarketPriceRule(store: { id: string; keptMarkets: readonly { code: string }[] }, accountId: string, rule: MarketPriceRule): Promise<RuleResult> {
  const existing = await marketPriceRules(store.id);
  const problem = ruleProblem(rule, store.keptMarkets.map((m) => m.code), existing) ?? (await rateProblem(store.id, rule));
  if (problem) return { ok: false, problem };
  const counts = await db().transaction(async (tx) => {
    await tx.execute(sql`
      insert into commerce.market_price_rules (store_id, market_code, base_market, percent_bps, basis, round_to_minor, ending_minor, updated_at)
      values (${store.id}::uuid, ${rule.market}, ${rule.base}, ${rule.percentBps}, ${rule.basis}, ${rule.roundToMinor}, ${rule.endingMinor}, now())
      on conflict (store_id, market_code) do update set base_market = excluded.base_market, percent_bps = excluded.percent_bps, basis = excluded.basis,
        round_to_minor = excluded.round_to_minor, ending_minor = excluded.ending_minor, updated_at = now()
    `);
    return deriveForProducts(tx, store.id, { markets: [rule.market] });
  });
  await audit(accountId, store.id, "settings.market_price_rule", { market: rule.market, base: rule.base, percentBps: rule.percentBps, basis: rule.basis, written: counts.written, ended: counts.ended }, { area: "settings" });
  return { ok: true, ...counts };
}

/** Takes a market's rule away: its derived prices stay as they are and become the owner's own (fixed). */
export async function removeMarketPriceRule(store: { id: string }, accountId: string, market: string): Promise<{ ok: true; kept: number }> {
  const kept = await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.market_price_rules where store_id = ${store.id}::uuid and market_code = ${market}`);
    const rows = await tx.execute<Row>(sql`
      update commerce.prices set derived = false
      where store_id = ${store.id}::uuid and market_code = ${market} and valid_to is null and derived
      returning id
    `);
    return rows.length;
  });
  await audit(accountId, store.id, "settings.market_price_rule_removed", { market, kept }, { area: "settings" });
  return { ok: true, kept };
}
