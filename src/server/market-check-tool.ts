import "server-only";

import { MARKET_CHECK_WORDS } from "@/lib/admin-words/market-check";
import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import { languageNames } from "@/lib/legal-admin-words";
import { conversionOf, findingText, FIX_PATHS, MIN_ORDERS, MIN_VISITS } from "@/lib/market-check";
import { OFFERS_PER_RIVAL, offerFresh, priceGap, RIVALS_PER_MARKET } from "@/lib/market-rivals";
import { englishMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { adminLink, BASIS, mainLocale, periodWords, type Ctx } from "./analytics-tools";
import { marketCheck } from "./market-check";
import { listRivals, readRivalOffer, rivalOffers, RivalError, type RivalProblem } from "./market-rivals";
import { OwnerToolError } from "./owner-tool-error";
import type { Account } from "./auth";

/**
 * The AI manager's `market_check` (D900 M1, `docs/market-check.md` 3.4), in a module of its own: the tools' map loads it when it is called,
 * so the market check's words are not in every admin page that reaches the tools.
 */
/**
 * The market check (D900 M1, `docs/market-check.md` 3.4): each country's facts and the findings, as Analytics → Markets reads and words
 * them (`marketCheck()`, `findingText()`), for the last `days` store days. A figure that cannot be known says so; nothing is worked out here.
 */
export async function marketCheckTool({ store }: Ctx, { days }: OwnerToolInput<"market_check">) {
  const now = new Date();
  const today = todayIn(now, store.timeZone);
  const period = customPeriod(addDays(today, 1 - days), today);
  const check = await marketCheck(store, period, { now, locale: "en-GB" });
  const w = MARKET_CHECK_WORDS.en;
  const locale = mainLocale(store);
  const money = (minor: number | null) => (minor === null ? null : formatAmount(minor, check.currency, locale));
  const names = new Map(check.markets.map((m) => [m.code, m.name]));
  const languageName = (code: string) => languageNames([code.split("-")[0]], "en");
  const notCounted = check.coverage.counting ? "no day of the period was counted" : "visit counting is off (Analytics → Settings)";
  return {
    period: periodWords(period),
    basis: `${BASIS} Visits and conversion are counted as on the Traffic page; orders are those placed in each country.`,
    countries: check.markets.map((m) => ({
      country: m.name,
      code: m.code,
      offered: m.sells,
      visits: m.visits ?? `not known: ${notCounted}`,
      conversion: m.visits === null ? `not known: ${notCounted}` : formatPercent(conversionOf(m)),
      ...(check.sells && {
        orders: m.orders,
        revenue: money(m.revenueMinor),
        average_order: m.orders && m.revenueMinor !== null ? money(Math.round(m.revenueMinor / m.orders)) : null,
        products_without_price: m.unpriced,
      }),
      searches: m.searches ?? "not known: searches are kept 90 days",
      found_nothing: m.misses,
      most_missed: m.missedTerms.map((t) => `${t.term} (${t.misses})`),
      ...(m.locale && { products_without_a_name_in: { language: languageName(m.locale), products: m.untranslated } }),
    })),
    findings: check.findings.map((f) => ({
      kind: f.kind,
      text: findingText(f, w.finding, names, languageName, (minor, currency) => formatAmount(minor, currency, locale)),
      page: adminLink(store, FIX_PATHS[f.kind]),
    })),
    notes: [
      check.house ? w.notes.house : !check.sells ? w.notes.noShop : null,
      `A country is compared with the rest only when both have at least ${MIN_VISITS} visits and the rest at least ${MIN_ORDERS} orders, and the difference is too large to be chance.`,
      check.findings.length === 0 ? w.nothingToDo : null,
    ].filter((n): n is string => n !== null),
    page: adminLink(store, `/analytics/markets?period=custom&from=${period.from}&to=${addDays(period.to, -1)}`),
  };
}

/** A rival refusal in the AI manager's words. */
const RIVAL_PROBLEMS: Record<RivalProblem, string> = {
  market: "That is not one of the store's countries.",
  name: "Give the shop's name.",
  host: "Give the shop's web address.",
  full: `A country keeps ${RIVALS_PER_MARKET} rivals at most.`,
  exists: "That shop is already a rival in that country.",
  rival: "The store has no such rival: read list_rivals. Rivals are added by the owner on Analytics → Markets.",
  site: "That page is not on the rival's own site.",
  product: "The store has no product with that handle: read it from list_products.",
  offers: `A rival keeps ${OFFERS_PER_RIVAL} offers at most.`,
  no_offer: "That page states no price in its own machine-readable data, so nothing was kept. Its words are never read for a price.",
};

/** The store's rivals and their offers as Analytics → Markets shows them (D900 M2), every figure written by code. */
export async function listRivalsTool({ store }: Ctx) {
  const now = new Date();
  const [rivals, offers] = await Promise.all([listRivals(store.id), rivalOffers(store, store.localization.locales[0])]);
  return {
    rivals: rivals.map((r) => ({
      name: r.name,
      host: r.host,
      country: r.market,
      offers: offers
        .filter((o) => o.rivalId === r.id)
        .map((o) => {
          const gap = priceGap(o.own, o);
          return {
            page: o.address,
            their_product: o.name,
            their_price: englishMoney(o.priceMinor, o.currency),
            your_product: o.productId ? o.productName : null,
            your_price: o.own ? englishMoney(o.own.priceMinor, o.own.currency) : null,
            difference: gap === null ? "not comparable" : gap > 0 ? `the store is ${formatPercent(gap, 0)} dearer` : `the store is ${formatPercent(-gap, 0)} cheaper`,
            availability: o.availability,
            shipping: o.shippingMinor !== null && o.shippingCurrency ? englishMoney(o.shippingMinor, o.shippingCurrency) : null,
            delivery_days: o.deliveryDaysMin !== null ? `${o.deliveryDaysMin}-${o.deliveryDaysMax}` : null,
            return_days: o.returnDays,
            read: o.readAt.slice(0, 10),
            old: !offerFresh(o.readAt, now),
          };
        }),
    })),
    note: rivals.length === 0 ? "The owner has added no rivals yet: they add them on Analytics → Markets." : "Prices are as each rival's own page states them, VAT as the page shows it.",
    page: adminLink(store, "/analytics/markets"),
  };
}

/** Reads one rival product page and keeps its offer (D900 M2), refused in words the model can pass on. */
export async function readRivalOfferTool({ account, store }: Ctx & { account: Account }, input: OwnerToolInput<"read_rival_offer">) {
  try {
    const { offer } = await readRivalOffer({ account, store }, { rival: input.rival, page: input.page, product: input.product ?? null });
    return {
      kept: true,
      their_product: offer.name,
      their_price: englishMoney(offer.priceMinor, offer.currency),
      availability: offer.availability,
      note: "Kept on Analytics → Markets. list_rivals holds it against the store's own price.",
    };
  } catch (error) {
    if (error instanceof RivalError) throw new OwnerToolError(RIVAL_PROBLEMS[error.problem]);
    throw error;
  }
}
