import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { marketCheckEn } from "@/lib/admin-messages/market-check.en";
import { marketCheckNb } from "@/lib/admin-messages/market-check.nb";
import { marketFindings, type MarketCheckFacts, type MarketFacts } from "@/lib/market-check";
import type { MarketCheck } from "@/server/market-check";

import { MarketCheckView, type MarketCheckViewProps } from "./market-check-view";

/** Analytics → Markets (D900 M1): what Homer sees first, and the figures one step away for Lisa. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

const country = (code: string, name: string, over: Partial<MarketFacts> = {}): MarketFacts => ({
  code,
  name,
  sells: true,
  visits: 0,
  visitOrders: 0,
  orders: 0,
  revenueMinor: 0,
  searches: 0,
  misses: 0,
  missedTerms: [],
  unpriced: 0,
  locale: null,
  untranslated: null,
  ...over,
});

function check(markets: MarketFacts[], over: Partial<MarketCheck> = {}, demand: MarketCheckFacts["demand"] = []): MarketCheck {
  const facts: MarketCheckFacts = { markets, products: 40, demand, rivalOffers: [] };
  return {
    ...facts,
    findings: marketFindings(facts),
    currency: "NOK",
    mainLocale: "nb-NO",
    coverage: { counting: true, firstDay: "2026-01-01", partial: false, from: "2026-10-27", to: "2026-11-26", days: 30 },
    searchesEmpty: false,
    searchesClamped: false,
    searchesFrom: "2026-08-28",
    sells: true,
    house: false,
    rivals: [],
    offers: [],
    ...over,
  };
}

const props = (c: MarketCheck, over: Partial<MarketCheckViewProps> = {}): MarketCheckViewProps => ({
  base: "/admin/acme",
  lang: "en",
  locale: "nb-NO",
  check: c,
  periodLabel: "Last 30 days",
  words: marketCheckEn,
  ...over,
});

const busy = check(
  [
    country("NO", "Norway", { visits: 4000, visitOrders: 200, orders: 210, revenueMinor: 2_100_000, searches: 300, misses: 30, missedTerms: [{ term: "ull", misses: 12 }] }),
    country("DE", "Germany", { visits: 1000, visitOrders: 5, orders: 5, revenueMinor: 40_000, searches: 120, misses: 41, missedTerms: [{ term: "linen", misses: 39 }], locale: "de-DE", untranslated: 12, unpriced: 3 }),
    country("SE", "Sweden", { sells: false, visits: 30, visitOrders: 0, orders: 0, revenueMinor: 0, unpriced: null }),
  ],
  {},
  [{ term: "linen", misses: 39, markets: [{ code: "DE", misses: 39 }] }],
);

describe("Analytics → Markets (D900 M1)", () => {
  it("opens on three findings of three kinds, each with Make a plan and the page that fixes it", () => {
    const out = html(h(MarketCheckView, props(busy)));
    const todo = out.slice(out.indexOf("What to do in your markets"), out.indexOf("See every country and every finding"));
    expect(todo.match(/data-finding="/g)).toHaveLength(3);
    expect(todo).toContain('data-finding="weak_market"');
    expect(todo).toContain('data-finding="unmet_demand"');
    expect(todo).toContain('data-finding="untranslated"');
    expect(todo).toContain("Visitors in Germany buy less: 0.5 % of visits end in an order");
    expect(todo).toContain("Shoppers searched for “linen” 39 times and found nothing, most of them in Germany.");
    expect(todo).toContain('href="/admin/acme/analytics/traffic"');
    expect(todo).toContain('href="/admin/acme/search"');
    expect(todo).toContain('href="/admin/acme/translate"');
  });

  it("keeps every country's figures and the rest of the findings one step away", () => {
    const out = html(h(MarketCheckView, props(busy)));
    expect(out).toContain("<details");
    expect(out).toMatch(/See every country and every finding[\s\S]*more finding[\s\S]*Every country, side by side/);
    expect(out).toContain('data-finding="unpriced"');
    // The countries' table: a country no longer offered is marked, and its prices do not apply.
    expect(out).toContain("Not offered now");
    expect(out).toContain("Average order");
    // The terms that found nothing, by country.
    expect(out).toContain('data-market-terms="DE"');
    expect(out).toContain("39 times");
  });

  it("says what is not known instead of a zero", () => {
    const off = check([country("NO", "Norway", { visits: null, visitOrders: null })], {
      coverage: { counting: false, firstDay: null, partial: false, from: null, to: null, days: 0 },
      searchesEmpty: true,
    });
    const out = html(h(MarketCheckView, props(off)));
    expect(out).toContain("Visits are not counted, so no country has a conversion.");
    expect(out).toContain('href="/admin/acme/analytics/settings"');
    expect(out).toContain("Not counted");
    expect(out).toContain("No searches from this period are kept any more");
    expect(out).toContain("Nothing stands out in this period");
  });

  it("leaves out orders and prices for Kaizena Flow's own store, and says why", () => {
    const house = check([country("NO", "Norway", { orders: null, revenueMinor: null, unpriced: null })], { sells: false, house: true });
    const out = html(h(MarketCheckView, props(house)));
    expect(out).toContain("Kaizena Flow sells plans, not goods");
    expect(out).not.toContain("Average order");
    expect(out).not.toContain("No price");
  });

  it("reads in Norwegian", () => {
    const out = html(h(MarketCheckView, props(busy, { lang: "nb", words: marketCheckNb })));
    expect(out).toContain("Hva du kan gjøre i markedene dine");
    expect(out).toContain("Besøkende i Germany kjøper mindre");
    expect(out).toContain("Se alle land og alle funn");
    expect(out).toContain("Alle land, side om side");
  });
});
