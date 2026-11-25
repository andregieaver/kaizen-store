import { describe, expect, it } from "vitest";

import { marketCheckEn } from "./admin-messages/market-check.en";
import { englishMoney } from "./money";
import {
  askAboutFinding,
  conversionOf,
  findingText,
  marketFindings,
  MIN_MISSES,
  MIN_ORDERS,
  MIN_VISITS,
  missRateOf,
  type MarketCheckFacts,
  type MarketFacts,
} from "./market-check";

const country = (code: string, over: Partial<MarketFacts> = {}): MarketFacts => ({
  code,
  name: code,
  sells: true,
  visits: null,
  visitOrders: null,
  orders: null,
  revenueMinor: null,
  searches: null,
  misses: null,
  missedTerms: [],
  unpriced: null,
  locale: null,
  untranslated: null,
  ...over,
});

const facts = (markets: MarketFacts[], over: Partial<MarketCheckFacts> = {}): MarketCheckFacts => ({ markets, products: 100, demand: [], rivalOffers: [], ...over });
const names = new Map([
  ["NO", "Norway"],
  ["DE", "Germany"],
  ["SE", "Sweden"],
]);
const language = (l: string) => (l.startsWith("de") ? "German" : l);

describe("the market check's findings (D900 M1)", () => {
  it("finds a country that buys clearly less than the rest, with the orders it missed as an estimate", () => {
    const found = marketFindings(facts([country("NO", { visits: 2000, visitOrders: 60 }), country("DE", { visits: 1000, visitOrders: 5 })]));
    const weak = found.find((f) => f.kind === "weak_market");
    expect(weak).toMatchObject({ kind: "weak_market", market: "DE", visits: 1000, orders: 5, restVisits: 2000, restOrders: 60 });
    // At the rest's 3 % the 1,000 visits would have made 30 orders: 25 more than the 5 it had.
    expect(weak && weak.kind === "weak_market" ? weak.gap : null).toBe(25);
    // Norway is not called strong: its rest (Germany) has fewer than MIN_ORDERS orders to hold it against.
    expect(found.find((f) => f.kind === "strong_market")).toBeUndefined();
  });

  it("raises nothing on small numbers or a difference that may be chance", () => {
    // Too few visits in the country.
    expect(marketFindings(facts([country("NO", { visits: 5000, visitOrders: 150 }), country("DE", { visits: MIN_VISITS - 1, visitOrders: 0 })]))).toEqual([]);
    // Too few orders in the rest.
    expect(marketFindings(facts([country("NO", { visits: 5000, visitOrders: MIN_ORDERS - 1 }), country("DE", { visits: 5000, visitOrders: 0 })]))).toEqual([]);
    // Rates that differ a little: 3 % against 2.8 %.
    expect(marketFindings(facts([country("NO", { visits: 1000, visitOrders: 30 }), country("DE", { visits: 1000, visitOrders: 28 })]))).toEqual([]);
    // Visits not counted: no conversion to compare, never a zero.
    expect(marketFindings(facts([country("NO"), country("DE")]))).toEqual([]);
  });

  it("keeps a term that found nothing only from MIN_MISSES misses", () => {
    const demand = [
      { term: "linen", misses: MIN_MISSES, markets: [{ code: "DE", misses: MIN_MISSES }] },
      { term: "wool", misses: MIN_MISSES - 1, markets: [{ code: "NO", misses: MIN_MISSES - 1 }] },
    ];
    expect(marketFindings(facts([country("DE")], { demand })).map((f) => (f.kind === "unmet_demand" ? f.term : f.kind))).toEqual(["linen"]);
  });

  it("finds missing names in a country's language and missing prices only where the store sells", () => {
    const found = marketFindings(
      facts([
        country("DE", { locale: "de-DE", untranslated: 12, unpriced: 3 }),
        country("SE", { sells: false, unpriced: 7 }),
        country("NO", { locale: null, untranslated: null, unpriced: 0 }),
      ]),
    );
    expect(found).toEqual([
      { kind: "untranslated", market: "DE", locale: "de-DE", products: 12, of: 100 },
      { kind: "unpriced", market: "DE", products: 3, of: 100 },
    ]);
  });

  it("orders findings one of each kind first, each kind's largest first", () => {
    const found = marketFindings(
      facts(
        [
          country("NO", { visits: 4000, visitOrders: 200 }),
          country("DE", { visits: 1000, visitOrders: 5, locale: "de-DE", untranslated: 4, unpriced: 2 }),
          country("SE", { visits: 1000, visitOrders: 10, locale: "sv-SE", untranslated: 30 }),
        ],
        {
          demand: [
            { term: "wool", misses: 6, markets: [{ code: "NO", misses: 6 }] },
            { term: "linen", misses: 40, markets: [{ code: "DE", misses: 40 }] },
          ],
        },
      ),
    );
    const kinds = found.map((f) => f.kind);
    expect(kinds.slice(0, 5)).toEqual(["weak_market", "unmet_demand", "untranslated", "unpriced", "strong_market"]);
    // The largest of a kind first: Germany misses more orders than Sweden, "linen" more searches than "wool", Sweden more names.
    expect(found[0]).toMatchObject({ kind: "weak_market", market: "DE" });
    expect(found[1]).toMatchObject({ kind: "unmet_demand", term: "linen" });
    expect(found[2]).toMatchObject({ kind: "untranslated", market: "SE" });
    expect(found.slice(5).map((f) => f.kind)).toEqual(["weak_market", "unmet_demand", "untranslated"]);
  });

  it("finds a rival a tenth or more cheaper, in the same currency and read within 30 days, and nothing else (D900 M2)", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const offer = (over: Partial<MarketCheckFacts["rivalOffers"][number]>) => ({
      rivalName: "Linnet",
      market: "NO",
      productName: "Linen apron",
      priceMinor: 40000,
      currency: "NOK",
      own: { priceMinor: 46000, currency: "NOK" },
      readAt: "2026-11-20T10:00:00Z",
      ...over,
    });
    const found = marketFindings(
      facts([country("NO")], {
        rivalOffers: [
          offer({}),
          offer({ productName: "Close call", own: { priceMinor: 43900, currency: "NOK" } }),
          offer({ productName: "Old", readAt: "2026-10-01T10:00:00Z" }),
          offer({ productName: "Other currency", currency: "EUR", priceMinor: 3000 }),
          offer({ productName: "Not held", own: null }),
          offer({ productName: "Cheaper here", own: { priceMinor: 35000, currency: "NOK" } }),
        ],
      }),
      now,
    );
    expect(found).toEqual([{ kind: "rival_cheaper", market: "NO", productName: "Linen apron", rivalName: "Linnet", ownMinor: 46000, rivalMinor: 40000, currency: "NOK", gap: 0.15 }]);
    expect(findingText(found[0], marketCheckEn.finding, names, language)).toBe(
      `Linnet sells Linen apron for ${englishMoney(40000, "NOK")} in Norway, and you ask ${englishMoney(46000, "NOK")}: 15 % more.`,
    );
  });

  it("works out rates only from what is known", () => {
    expect(conversionOf({ visits: 200, visitOrders: 4 })).toBe(0.02);
    expect(conversionOf({ visits: null, visitOrders: null })).toBeNull();
    expect(conversionOf({ visits: 0, visitOrders: 0 })).toBeNull();
    expect(missRateOf({ searches: 50, misses: 5 })).toBe(0.1);
    expect(missRateOf({ searches: null, misses: null })).toBeNull();
  });
});

describe("the market check's words (D900 M1)", () => {
  const w = marketCheckEn.finding;

  it("writes each finding with its figures from code", () => {
    const [weak] = marketFindings(facts([country("NO", { visits: 2000, visitOrders: 60 }), country("DE", { visits: 1000, visitOrders: 5 })]));
    expect(findingText(weak, w, names, language)).toBe(
      "Visitors in Germany buy less: 0.5 % of visits end in an order, against 3.0 % in your other countries. At that rate it would have had about 25 more orders.",
    );
    expect(findingText({ kind: "unmet_demand", term: "linen", misses: 41, markets: [{ code: "SE", misses: 2 }, { code: "DE", misses: 39 }] }, w, names, language)).toBe(
      "Shoppers searched for “linen” 41 times and found nothing, most of them in Germany.",
    );
    expect(findingText({ kind: "untranslated", market: "DE", locale: "de-DE", products: 12, of: 100 }, w, names, language)).toBe(
      "12 of your 100 products have no name in German, so shoppers in Germany read them in another language.",
    );
    expect(findingText({ kind: "unpriced", market: "XX", products: 3, of: 100 }, w, names, language)).toBe("3 of your 100 products have no price in XX, so they cannot be bought there.");
  });

  it("cuts a long term and hands the AI manager the finding with a plan kept for a yes", () => {
    const text = findingText({ kind: "unmet_demand", term: "x".repeat(80), misses: 5, markets: [] }, w, names, language);
    expect(text).toContain(`“${"x".repeat(59)}…”`);
    const message = askAboutFinding("Shoppers searched for “linen” 41 times and found nothing.", "last 30 days", marketCheckEn.ask);
    expect(message).toBe(
      "Analytics → Markets found this for last 30 days: Shoppers searched for “linen” 41 times and found nothing. Look into it with your tools and make a plan I can say yes to. Change nothing before I do.",
    );
  });
});
