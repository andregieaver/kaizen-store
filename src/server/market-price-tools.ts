import "server-only";

import { formatMoney } from "@/lib/money";
import { minorOf, ruleProblem, ruleSentence, type MarketPriceRule } from "@/lib/market-prices";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Account } from "./auth";
import { catalogTag } from "./catalog";
import { lowestMargin, type MarginRow } from "@/lib/margin-floor";

import { toMainOne } from "./analytics-sql";
import { derivedCounts, marketPriceRules, previewRule, rateProblem, removeMarketPriceRule, ruleEffect, saveMarketPriceRule } from "./market-prices";
import { OwnerToolError } from "./owner-tool-error";
import { storeTag, type Store } from "./stores";

/**
 * The AI manager's price rules (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2): `market_price_rules` reads each country's rule as the
 * Countries page shows it; `set_market_price_rule` changes every price of a country at once, so it waits for the owner's yes (gate `public`) and
 * goes through the page's own writers (`saveMarketPriceRule()`, `removeMarketPriceRule()`). Amounts are converted to minor units here and the
 * sentences are code's (`ruleSentence()`).
 */

type Ctx = { account: Account; store: Store; invalidate?: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store) => `/admin/${store.slug}/settings/countries`;

const currencyOf = (store: Store, code: string) => store.keptMarkets.find((m) => m.code === code)?.nativeCurrency ?? null;

/** Each of the store's countries: how its prices are set, and how many are the rule's now. */
export async function marketPriceRulesTool({ store }: Ctx) {
  const [rules, counts] = await Promise.all([marketPriceRules(store.id), derivedCounts(store.id)]);
  return {
    countries: store.keptMarkets.map((m, n) => {
      const rule = rules.find((r) => r.market === m.code);
      return {
        country: m.code,
        currency: m.nativeCurrency,
        own_country: n === 0,
        prices: rule ? ruleSentence(rule, m.nativeCurrency) : "Set by hand.",
        prices_by_rule: counts.get(m.code) ?? 0,
      };
    }),
    note: "A price typed by hand in a country with a rule stays as typed; an empty one follows the rule.",
    admin: adminLink(store),
  };
}

/** The rule the input asks for, in minor units, or a refusal in words. */
function asRule(store: Store, input: OwnerToolInput<"set_market_price_rule">): MarketPriceRule {
  const country = input.country.toUpperCase();
  const currency = currencyOf(store, country) ?? fail(`${country} is not one of the store's countries. Read market_price_rules.`);
  const round = input.round_to === undefined ? 1 : minorOf(input.round_to, currency);
  if (round === null || round < 1) return fail(`The rounding step is not an amount in ${currency}.`);
  const ending = input.ending === undefined ? null : minorOf(input.ending, currency);
  if (input.ending !== undefined && ending === null) return fail(`The ending is not an amount in ${currency}.`);
  return { market: country, base: (input.from ?? "").toUpperCase(), percentBps: Math.round(input.percent * 100), basis: input.vat, roundToMinor: round, endingMinor: ending };
}

/** Checks the change before it is kept for a yes: what the Countries page would refuse is refused now, in its words. */
export async function preflightPriceRuleTool({ store }: Ctx, raw: Record<string, unknown>): Promise<void> {
  const input = raw as OwnerToolInput<"set_market_price_rule">;
  const rules = await marketPriceRules(store.id);
  if (input.from === null) {
    if (!rules.some((r) => r.market === input.country.toUpperCase())) fail(`The prices in ${input.country.toUpperCase()} are already set by hand.`);
    return;
  }
  const rule = asRule(store, input);
  const problem = ruleProblem(rule, store.keptMarkets.map((m) => m.code), rules) ?? (await rateProblem(store.id, rule));
  if (problem) fail(problem);
}

/**
 * A rule's facts for the autopilot in the challenge (A2, D804): the largest change to a price it would make, in percent of the price before (a
 * price where there was none counts as no change), and the lowest margin it would leave a product with a cost (the margin floor, D5). Taking a
 * rule away changes no price. Null facts when it cannot be measured, so it waits.
 */
export async function priceRuleAutopilotFacts(store: Store, raw: Record<string, unknown>): Promise<{ priceChangePercent: number | null; lowestMarginPercent?: number | null; marginUntouched?: boolean }> {
  try {
    const input = raw as OwnerToolInput<"set_market_price_rule">;
    if (input.from === null) return { priceChangePercent: 0, marginUntouched: true };
    const rule = asRule(store, input);
    const effect = await ruleEffect(store.id, rule);
    if (!effect) return { priceChangePercent: null };
    let largest = 0;
    const rows: MarginRow[] = [];
    for (const price of effect.prices) {
      // A price the rule ends (no base price, no rate) stops selling the variant there: measured as a full change.
      if (price.after === null) {
        largest = Math.max(largest, 100);
        continue;
      }
      if (price.before !== null && price.before > 0) largest = Math.max(largest, (Math.abs(price.after - price.before) / price.before) * 100);
      if (price.costMinor === null) continue;
      const main = toMainOne(store, effect.currency, price.after);
      if (main !== null) rows.push({ priceMinor: main, vatRate: price.vatRate, costMinor: price.costMinor });
    }
    if (rows.length === 0 && effect.prices.length === 0) return { priceChangePercent: largest, marginUntouched: true };
    return { priceChangePercent: largest, lowestMarginPercent: lowestMargin(rows) };
  } catch {
    return { priceChangePercent: null };
  }
}

/** Saves or takes away the rule, then says what it did and shows five prices as they are now. */
export async function setMarketPriceRuleTool(ctx: Ctx, input: OwnerToolInput<"set_market_price_rule">) {
  const { store } = ctx;
  const refresh = () => {
    ctx.invalidate?.(catalogTag(store.id));
    ctx.invalidate?.(storeTag(store.slug));
  };
  if (input.from === null) {
    const { kept } = await removeMarketPriceRule(store, ctx.account.id, input.country.toUpperCase());
    refresh();
    return { done: `The prices in ${input.country.toUpperCase()} are set by hand again; ${kept} kept as they were.`, admin: adminLink(store) };
  }
  const rule = asRule(store, input);
  const saved = await saveMarketPriceRule(store, ctx.account.id, rule);
  if (!saved.ok) return fail(saved.problem);
  refresh();
  const locale = store.localization.locales[0] ?? "en";
  const currency = currencyOf(store, rule.market) ?? "";
  const sample = await previewRule(store.id, rule, locale);
  return {
    done: `${ruleSentence(rule, currency)} ${saved.written} prices written, ${saved.ended} ended.`,
    sample: sample.map((s) => ({ product: s.title, sku: s.sku, price: s.after === null ? null : formatMoney(s.after, currency, locale) })),
    admin: adminLink(store),
  };
}
