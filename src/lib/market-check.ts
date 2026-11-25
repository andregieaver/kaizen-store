/**
 * The market check's first step (D900 M1, `docs/market-check.md` 3, `docs/analytics.md` "Markets"): the store against itself, country by
 * country, from its own figures only. The server reads the facts (`src/server/market-check.ts`); this module, pure, works out what they
 * mean: a country that buys clearly less or more than the rest, searches that found nothing, products without text in a country's language
 * or without a price there. Every finding has a minimum volume, so small numbers raise nothing, and code fixes their order. The model never
 * makes one: it is handed a finding's words and figures (`askAboutFinding()`) and only words a plan.
 */

import { fillWords } from "./admin-fill";
import { formatCount, formatPercent, safeRatio } from "./analytics-core";
import { twoProportionZ } from "./analytics-discounts";
import { offerFresh, PRICE_GAP_MIN, priceGap, rivalGone, rivalMove, type RivalMove, type RivalOfferFacts } from "./market-rivals";
import { englishMoney } from "./money";

/** Visits a country, and the rest of the store, need before their conversion is compared. */
export const MIN_VISITS = 200;
/** Orders the rest of the store needs before a country is held against it. */
export const MIN_ORDERS = 10;
/** How far apart, in standard errors, a country's conversion and the rest's must be (two-sided 95 %). */
export const MIN_Z = 1.96;
/** Misses a term needs in the period before it is a finding. */
export const MIN_MISSES = 5;
/** Terms that found nothing, at most, as findings. */
export const DEMAND_TERMS = 10;
/** Terms that found nothing shown per country. */
export const MARKET_TERMS = 5;
/** The findings shown first, to Homer. */
export const FINDINGS_SHOWN = 3;

/** One country, as the server read it. `null` is *not known* (or not applicable), never zero. */
export type MarketFacts = {
  /** The country, upper case. */
  code: string;
  name: string;
  /** The store sells to it now (one of `store.markets`); false for a country only a visit or a search of the period was in. */
  sells: boolean;
  /** Visitor-days of the covered days; null while visits are not counted. */
  visits: number | null;
  /** Paid orders from those visits: conversion's numerator. Null with `visits`. */
  visitOrders: number | null;
  /** Paid orders placed in the country's market, its revenue without VAT in the main currency. Null where orders do not apply (the house). */
  orders: number | null;
  revenueMinor: number | null;
  /** Searches of the store search in the country, and those that found nothing; null when no searched day of the period is still kept. */
  searches: number | null;
  misses: number | null;
  /** The terms that found nothing most often there, most first. */
  missedTerms: { term: string; misses: number }[];
  /** Active products with no price there; null where it does not apply (not sold to, no shop, the house). */
  unpriced: number | null;
  /** The country's own language when it is not the store's main one; null otherwise. */
  locale: string | null;
  /** Products without text in `locale`; null when `locale` is. */
  untranslated: number | null;
};

/** A term that found nothing, across the countries it was searched in. */
export type DemandTerm = { term: string; misses: number; markets: { code: string; misses: number }[] };

export type MarketCheckFacts = {
  markets: MarketFacts[];
  /** Active products (demo products left out): what `unpriced` and `untranslated` are of. */
  products: number;
  /** Terms with at least `MIN_MISSES` misses, most first, at most `DEMAND_TERMS`. */
  demand: DemandTerm[];
  /** The rivals' offers held against the store's own products (D900 M2): every one kept, old ones too. */
  rivalOffers: RivalOfferFacts[];
};

export type MarketFindingKind =
  | "weak_market"
  | "unmet_demand"
  | "rival_cheaper"
  | "rival_move"
  | "untranslated"
  | "unpriced"
  | "rival_out"
  | "strong_market"
  | "rival_dearer";

/** The order in which kinds take turns (`docs/market-check.md` 3.2): what to fix before what to grow, and what to keep last. */
export const FINDING_KINDS: readonly MarketFindingKind[] = [
  "weak_market",
  "unmet_demand",
  "rival_cheaper",
  "rival_move",
  "untranslated",
  "unpriced",
  "rival_out",
  "strong_market",
  "rival_dearer",
];

/** A SWOT's four parts: two of the store itself, two of the market around it (`docs/market-check.md` 4). */
export type SwotPart = "strengths" | "weaknesses" | "opportunities" | "threats";
export const SWOT_PARTS: readonly SwotPart[] = ["strengths", "weaknesses", "opportunities", "threats"];

/**
 * Where each kind of finding stands in the SWOT (D900 M2): the SWOT is only a way of drawing the findings, never a text of its own. Threats
 * are rivals' moves, which watching them shows (M3).
 */
export const SWOT_OF: Record<MarketFindingKind, SwotPart> = {
  strong_market: "strengths",
  rival_dearer: "strengths",
  weak_market: "weaknesses",
  rival_cheaper: "weaknesses",
  untranslated: "weaknesses",
  unpriced: "weaknesses",
  unmet_demand: "opportunities",
  rival_out: "opportunities",
  rival_move: "threats",
};

/** The findings in their SWOT parts, each part in the findings' own order. */
export function swotOf<F extends { kind: MarketFindingKind }>(findings: readonly F[]): Record<SwotPart, F[]> {
  const out: Record<SwotPart, F[]> = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  for (const f of findings) out[SWOT_OF[f.kind]].push(f);
  return out;
}

/** Where each kind of finding is fixed, after the store's admin address: the page's link and the AI manager's `page`. */
export const FIX_PATHS: Record<MarketFindingKind, string> = {
  weak_market: "/analytics/traffic",
  strong_market: "/analytics/marketing",
  unmet_demand: "/search",
  rival_cheaper: "/products",
  rival_dearer: "/products",
  rival_out: "/marketing",
  rival_move: "/products",
  untranslated: "/translate",
  unpriced: "/products",
};

export type ConversionFinding = {
  kind: "weak_market" | "strong_market";
  market: string;
  /** The country's conversion and the rest's (0..1). */
  rate: number;
  restRate: number;
  visits: number;
  orders: number;
  restVisits: number;
  restOrders: number;
  z: number;
  /**
   * Orders apart, an estimate: for a weak country the orders it would have had at the rest's rate less those it had; for a strong one the
   * orders it had over that. Never negative.
   */
  gap: number;
};

export type MarketFinding =
  | ConversionFinding
  | { kind: "unmet_demand"; term: string; misses: number; markets: { code: string; misses: number }[] }
  | {
      kind: "rival_cheaper";
      market: string;
      productName: string;
      rivalName: string;
      ownMinor: number;
      rivalMinor: number;
      currency: string;
      /** How much dearer the store is (0.15: 15 %), worked out by `priceGap()`. */
      gap: number;
    }
  | {
      kind: "rival_dearer";
      market: string;
      productName: string;
      rivalName: string;
      ownMinor: number;
      rivalMinor: number;
      currency: string;
      /** How much cheaper the store is (0.2: 20 %), worked out by `priceGap()`. */
      gap: number;
    }
  /** A rival's offer out of stock or discontinued on its own page, for a product the store has a price for there. */
  | { kind: "rival_out"; market: string; productName: string; rivalName: string; ownMinor: number; currency: string }
  /** A rival's move against the store since its page was read before (D900 M3): a lower price, cheaper shipping or longer returns. */
  | ({ kind: "rival_move"; market: string; productName: string; rivalName: string } & RivalMove)
  | { kind: "untranslated"; market: string; locale: string; products: number; of: number }
  | { kind: "unpriced"; market: string; products: number; of: number };

/** The id of a finding, stable while its subject is: for a list key and the page's anchors. */
export function findingId(f: MarketFinding): string {
  if (f.kind === "unmet_demand") return `${f.kind}:${f.term}`;
  if (f.kind === "rival_cheaper" || f.kind === "rival_dearer" || f.kind === "rival_out" || f.kind === "rival_move") return `${f.kind}:${f.market}:${f.productName}:${f.rivalName}`;
  return `${f.kind}:${f.market}`;
}

/** The size a kind's findings are ranked by among themselves, largest first. */
function sizeOf(f: MarketFinding): number {
  switch (f.kind) {
    case "weak_market":
    case "strong_market":
    case "rival_cheaper":
    case "rival_dearer":
      return f.gap;
    case "rival_out":
      return f.ownMinor;
    case "rival_move":
      // A price cut first, by how far it fell; then shipping, then returns.
      return f.move === "price" ? 2 + (f.before - f.after) / Math.max(f.before, 1) : f.move === "shipping" ? 1 : 0;
    case "unmet_demand":
      return f.misses;
    case "untranslated":
    case "unpriced":
      return f.products;
  }
}

/** Each country held against the rest of the store, where both sides have enough visits and the difference is not chance. */
function conversionFindings(markets: readonly MarketFacts[]): ConversionFinding[] {
  const counted = markets.filter((m): m is MarketFacts & { visits: number; visitOrders: number } => m.visits !== null && m.visitOrders !== null);
  const visits = counted.reduce((n, m) => n + m.visits, 0);
  const orders = counted.reduce((n, m) => n + m.visitOrders, 0);
  const out: ConversionFinding[] = [];
  for (const m of counted) {
    const restVisits = visits - m.visits;
    const restOrders = orders - m.visitOrders;
    if (m.visits < MIN_VISITS || restVisits < MIN_VISITS || restOrders < MIN_ORDERS) continue;
    const z = twoProportionZ(restOrders, restVisits, m.visitOrders, m.visits);
    if (z === null || Math.abs(z) < MIN_Z) continue;
    const rate = m.visitOrders / m.visits;
    const restRate = restOrders / restVisits;
    const expected = Math.round(restRate * m.visits);
    const kind = z < 0 ? "weak_market" : "strong_market";
    const gap = Math.max(0, kind === "weak_market" ? expected - m.visitOrders : m.visitOrders - expected);
    out.push({ kind, market: m.code, rate, restRate, visits: m.visits, orders: m.visitOrders, restVisits, restOrders, z, gap });
  }
  return out;
}

/**
 * What the facts mean, in the order code fixes (`docs/market-check.md` 3.2): one finding of each kind in `FINDING_KINDS`' order, then the
 * next of each, each kind's largest first (ties by the country or term, so the order never depends on how the rows were read).
 */
export function marketFindings(facts: MarketCheckFacts, now: Date = new Date()): MarketFinding[] {
  const all: MarketFinding[] = [...conversionFindings(facts.markets)];
  for (const d of facts.demand) if (d.misses >= MIN_MISSES) all.push({ kind: "unmet_demand", term: d.term, misses: d.misses, markets: d.markets });
  // A rival's offer read within OFFER_FRESH_DAYS, held against the store's own price there: one it cannot sell now is a gap it leaves; else,
  // in the same currency, at least PRICE_GAP_MIN apart either way.
  for (const o of facts.rivalOffers) {
    if (!o.own || !offerFresh(o.readAt, now)) continue;
    // A move since the page was read before is a threat whatever the prices stand at now (M3).
    const move = rivalMove(o, now);
    if (move) all.push({ kind: "rival_move", market: o.market, productName: o.productName, rivalName: o.rivalName, ...move });
    const about = { market: o.market, productName: o.productName, rivalName: o.rivalName, ownMinor: o.own.priceMinor };
    if (rivalGone(o.availability)) {
      all.push({ kind: "rival_out", ...about, currency: o.own.currency });
      continue;
    }
    const gap = priceGap(o.own, o);
    if (gap === null) continue;
    if (gap >= PRICE_GAP_MIN) all.push({ kind: "rival_cheaper", ...about, rivalMinor: o.priceMinor, currency: o.currency, gap });
    else if (gap <= -PRICE_GAP_MIN) all.push({ kind: "rival_dearer", ...about, rivalMinor: o.priceMinor, currency: o.currency, gap: -gap });
  }
  for (const m of facts.markets) {
    if (m.locale && m.untranslated !== null && m.untranslated > 0) {
      all.push({ kind: "untranslated", market: m.code, locale: m.locale, products: m.untranslated, of: facts.products });
    }
    if (m.sells && m.unpriced !== null && m.unpriced > 0) all.push({ kind: "unpriced", market: m.code, products: m.unpriced, of: facts.products });
  }
  const queues = FINDING_KINDS.map((kind) =>
    all.filter((f) => f.kind === kind).sort((a, b) => sizeOf(b) - sizeOf(a) || findingId(a).localeCompare(findingId(b))),
  );
  const out: MarketFinding[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

/** A country's conversion (visit orders ÷ visits), or null while it cannot be known. */
export const conversionOf = (m: Pick<MarketFacts, "visits" | "visitOrders">): number | null =>
  m.visits === null || m.visitOrders === null ? null : safeRatio(m.visitOrders, m.visits);

/** Searches that found nothing over all searches, or null. */
export const missRateOf = (m: Pick<MarketFacts, "searches" | "misses">): number | null =>
  m.searches === null || m.misses === null ? null : safeRatio(m.misses, m.searches);

/** The words a finding is written with, in the reader's language (`marketsEn.finding`). */
export type FindingWords = {
  weak_market: string;
  strong_market: string;
  unmet_demand: string;
  unmetIn: string;
  rival_cheaper: string;
  rival_dearer: string;
  rival_out: string;
  rival_move: string;
  rivalShipping: string;
  rivalReturns: string;
  untranslated: string;
  unpriced: string;
};

/** The words the AI manager is handed, in the reader's language (`marketsEn.ask`). */
export type AskWords = { message: string; period: string; plan: string };

/** A country's name for the words: its own, else its code. */
const nameOf = (names: ReadonlyMap<string, string>, code: string) => names.get(code) ?? code;

/** The term as the words quote it: as searched, at most 60 characters. */
const quoted = (term: string) => (term.length > 60 ? `${term.slice(0, 59)}…` : term);

/**
 * One finding in one sentence, with its figures written by code: what the page shows and what the AI manager is handed. `languageName`
 * names a language code in the reader's language.
 */
export function findingText(
  f: MarketFinding,
  words: FindingWords,
  names: ReadonlyMap<string, string>,
  languageName: (locale: string) => string,
  money: (minor: number, currency: string) => string = englishMoney,
): string {
  switch (f.kind) {
    case "weak_market":
    case "strong_market":
      return fillWords(words[f.kind], {
        market: nameOf(names, f.market),
        rate: formatPercent(f.rate),
        rest: formatPercent(f.restRate),
        gap: formatCount(f.gap),
        visits: formatCount(f.visits),
      });
    case "unmet_demand": {
      const top = [...f.markets].sort((a, b) => b.misses - a.misses || a.code.localeCompare(b.code))[0];
      const where = top && f.markets.length > 0 ? fillWords(words.unmetIn, { market: nameOf(names, top.code) }) : "";
      return fillWords(words.unmet_demand, { term: quoted(f.term), n: formatCount(f.misses), where });
    }
    case "rival_cheaper":
    case "rival_dearer":
      return fillWords(words[f.kind], {
        rival: f.rivalName,
        product: f.productName,
        market: nameOf(names, f.market),
        theirs: money(f.rivalMinor, f.currency),
        yours: money(f.ownMinor, f.currency),
        gap: formatPercent(f.gap, 0),
      });
    case "rival_move": {
      const said = { rival: f.rivalName, product: f.productName, market: nameOf(names, f.market) };
      if (f.move === "returns") return fillWords(words.rivalReturns, { ...said, before: formatCount(f.before), after: formatCount(f.after) });
      const at = (minor: number) => money(minor, f.currency ?? "");
      return fillWords(f.move === "price" ? words.rival_move : words.rivalShipping, { ...said, before: at(f.before), after: at(f.after) });
    }
    case "rival_out":
      return fillWords(words.rival_out, { rival: f.rivalName, product: f.productName, market: nameOf(names, f.market), yours: money(f.ownMinor, f.currency) });
    case "untranslated":
      return fillWords(words.untranslated, { market: nameOf(names, f.market), language: languageName(f.locale), n: formatCount(f.products), of: formatCount(f.of) });
    case "unpriced":
      return fillWords(words.unpriced, { market: nameOf(names, f.market), n: formatCount(f.products), of: formatCount(f.of) });
  }
}

/**
 * The first message for *Make a plan* (D900): the finding's sentence and its period, written by code, asking for a plan kept for the
 * person's yes. Nothing in it is the model's, and it is sent only when the person sends it.
 */
export function askAboutFinding(text: string, periodLabel: string, words: AskWords): string {
  return fillWords(words.message, { finding: text, period: fillWords(words.period, { period: periodLabel }), plan: words.plan });
}
