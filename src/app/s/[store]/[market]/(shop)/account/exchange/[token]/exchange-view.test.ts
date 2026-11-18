import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The actions are server actions; the page's states are what is tested (wave 3, D239, `docs/wave-3-exchanges.md` 2.1 and 6.1).
vi.mock("./actions", () => ({
  confirmExchangeAction: async () => ({ problem: null }),
  declineExchangeAction: async () => ({ problem: null }),
  startExchangePaymentAction: async () => ({ problem: null }),
}));
vi.mock("server-only", () => ({}));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { ExchangeView, type ExchangePageFound } from "./exchange-view";

const TOKEN = "T".repeat(43);
const MARKETS: Record<string, Market> = {
  nb: { slug: "no", code: "NO", currency: "NOK", locale: "nb-NO", lang: "nb" } as Market,
  sv: { slug: "se", code: "SE", currency: "SEK", locale: "sv-SE", lang: "sv" } as Market,
  da: { slug: "dk", code: "DK", currency: "DKK", locale: "da-DK", lang: "da" } as Market,
  en: { slug: "no-en-eur", code: "NO", currency: "EUR", locale: "en-IE", lang: "en" } as Market,
};
const store = {
  id: "s1",
  slug: "demo",
  name: "Demo Butikk",
  timeZone: "Europe/Oslo",
  details: { legalName: "Demo Butikk AS", organisationNumber: "923456789", contactEmail: "hei@demo.test", postalAddress: "Storgata 1\n0182 Oslo", country: "NO" },
} as unknown as Store;

/** An exchange of return 1042-R1: a credit of 500,00 and replacements of `total` (shipping free), so Δ = total − 500,00. */
const exchange = (over: Record<string, unknown> = {}, total = 64900, credit = 50000) => {
  const difference = total - credit;
  return {
    id: "x1",
    seq: 1,
    status: "proposed",
    returnId: "r1",
    returnNumber: "1042-R1",
    returnKind: "withdrawal",
    orderId: "o1",
    orderNumber: "1042",
    currency: "NOK",
    marketSlug: "no",
    shippingKind: "free",
    shippingMinor: 0,
    deliveryAddress: null,
    creditMinor: credit,
    totalMinor: total,
    differenceMinor: difference,
    creditAtProcessingMinor: null,
    differenceAtProcessingMinor: null,
    outcome: {
      kind: difference < 0 ? "refund_due" : difference === 0 ? "even" : "to_pay",
      differenceMinor: difference,
      transferMinor: Math.min(credit, total),
      refundMinor: Math.max(0, -difference),
      toPayMinor: Math.max(0, difference),
    },
    expiresAt: "2026-10-14T10:30:00.000Z",
    confirmedAt: null,
    confirmedBy: null,
    confirmedChannel: null,
    exchangeOrderId: null,
    exchangeOrderNumber: null,
    exchangeOrderStatus: null,
    remainderRefundId: null,
    madeBy: "a1",
    createdAt: "2026-10-07T10:30:00.000Z",
    processedAt: null,
    settledAt: null,
    endedAt: null,
    lines: [{ n: 1, variantId: "v1", sku: "SWEATER-M", title: "Ullgenser – M", quantity: 1, listPriceMinor: 64900, unitPriceMinor: total, totalMinor: total }],
    terms: null,
    ...over,
  } as unknown as ExchangePageFound["exchange"];
};
const ret = {
  number: "1042-R1",
  lines: [
    { title: "Ullgenser – S", quantity: 1, decision: "accept", declineReason: null },
    { title: "Kopp", quantity: 1, decision: "decline", declineReason: "Opened" },
  ],
} as unknown as ExchangePageFound["ret"];
const credit = (final = false) => ({
  amountMinor: 50000,
  working: [
    { key: "goods", amountMinor: 59900 },
    { key: "deductions", amountMinor: 0 },
    { key: "shipping", amountMinor: 0 },
    { key: "return_shipping", amountMinor: -9900 },
  ],
  final,
  returnShippingMinor: 9900,
}) as ExchangePageFound["credit"];
const found = (state: ExchangePageFound["state"], x = exchange(), withCredit: ExchangePageFound["credit"] = credit()): ExchangePageFound =>
  ({ state, exchange: x, credit: withCredit, ret, terms: "link", withdrawalRight: true }) as ExchangePageFound;
const draw = (page: ExchangePageFound, extra: { lang?: string; withdrawalHref?: string | null; terms?: { mode: "link" | "checkbox" } | null } = {}) =>
  renderToString(
    createElement(ExchangeView, {
      page,
      store,
      market: MARKETS[extra.lang ?? "en"],
      token: TOKEN,
      terms: extra.terms
        ? ({ mode: extra.terms.mode, kind: "terms", pages: [{ role: "terms", title: "the terms", href: "/s/demo/no/vilkar" }] } as never)
        : null,
      withdrawalHref: extra.withdrawalHref ?? null,
    }),
  );
const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ | /g, " ")
    .replace(/\s+/g, " ")
    .trim();

const en = t("en").exchange;

describe("ExchangeView: the right of withdrawal for the new goods (review finding)", () => {
  it("tells a consumer of their 14 days, and never tells a business buyer (or excluded goods) of a statutory right: only the store's information", () => {
    const consumer = words(draw(found("proposed"), { withdrawalHref: "/s/demo/no/angrerett" }));
    expect(consumer).toContain(en.newPurchase);
    const business = draw({ ...found("proposed"), withdrawalRight: false } as ExchangePageFound, { withdrawalHref: "/s/demo/no/angrerett" });
    expect(words(business)).not.toContain(en.newPurchase);
    expect(words(business)).not.toContain("14 days");
    expect(business).toContain('href="/s/demo/no/angrerett"');
    for (const lang of ["nb", "sv", "da"] as const) {
      expect(words(draw({ ...found("proposed"), withdrawalRight: false } as ExchangePageFound, { lang })), lang).not.toContain(t(lang).exchange.newPurchase);
    }
  });
});

describe("ExchangeView: the agreement beside a payment (review finding)", () => {
  it("says only that being paid back this way has no fee, and says plainly that the customer pays the difference", () => {
    const toPay = words(draw(found("proposed")));
    expect(toPay).toMatch(/You pay NOK\s?149\.00/);
    expect(toPay).toContain("Being paid back this way has no fee.");
    expect(toPay).not.toMatch(/costs you nothing/i);
    expect(toPay).toMatch(/you pay the difference, NOK\s?149\.00, yourself/);
    const refund = words(draw(found("proposed", exchange({}, 30000))));
    expect(refund).not.toContain("you pay the difference");
    for (const lang of ["nb", "sv", "da"] as const) {
      const text = words(draw(found("proposed"), { lang }));
      expect(text, lang).not.toMatch(/ingenting ekstra|intet ekstra|ingenting extra/);
    }
  });
});

describe("ExchangeView: a proposal", () => {
  it("shows the seller, what is sent back, the credit with its working, what comes instead, the total and the outcome", () => {
    const markup = draw(found("proposed"), { withdrawalHref: "/s/demo/no/angrerett" });
    const text = words(markup);
    expect(text).toContain("Your exchange · Return 1042-R1");
    expect(text).toContain("Seller Demo Butikk AS");
    expect(text).toContain("923456789");
    expect(text).toContain("hei@demo.test");
    // What is sent back: the accepted lines only.
    expect(text).toContain("What you send back Ullgenser – S × 1");
    expect(text).not.toContain("Kopp");
    // The credit is the refund's own working, a deduction shown as a minus.
    expect(text).toMatch(/The goods you send back NOK\s?599\.00/);
    expect(text).toMatch(/Return shipping −NOK\s?99\.00/);
    expect(text).not.toContain("Deduction for reduced value");
    expect(text).toMatch(/Your credit NOK\s?500\.00/);
    expect(text).toContain(en.creditStillChanging);
    expect(text).toMatch(/1 × Ullgenser – M NOK\s?649\.00/);
    expect(text).toContain("Shipping Free");
    expect(text).toMatch(/Total of the new order NOK\s?649\.00/);
    expect(text).toMatch(/You pay NOK\s?149\.00/);
    // The express agreement (CRD Art. 13(1)), the new purchase's own right of withdrawal and the date after which the money comes back as usual.
    expect(text).toContain(en.agreement);
    expect(text).toContain(en.newPurchase);
    expect(markup).toContain('href="/s/demo/no/angrerett"');
    expect(text).toMatch(/If you do not confirm by 14 October 2026.*you get your money back as usual\./);
    // Two answers, nothing charged here: no card field, no Stripe.js.
    expect(text).toContain("Confirm the exchange");
    expect(text).toContain("No thanks, refund me instead");
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).not.toMatch(/stripe\.com\/v3|<iframe/);
  });

  it("says a refund is due, or that it is even, in the order's currency", () => {
    expect(words(draw(found("proposed", exchange({}, 30000))))).toMatch(/We refund you NOK\s?200\.00/);
    expect(words(draw(found("proposed", exchange({}, 50000))))).toContain("Nothing more to pay or refund");
  });

  it("does not say the credit can still change once the inspection is recorded", () => {
    expect(words(draw(found("proposed", exchange(), credit(true))))).not.toContain(en.creditStillChanging);
  });

  it("draws the store's terms as the checkout does, with a tick box held until ticked in checkbox mode", () => {
    const link = draw(found("proposed"), { terms: { mode: "link" } });
    expect(link).toContain('data-terms="link"');
    expect(link).toContain('href="/s/demo/no/vilkar"');
    const box = draw(found("proposed"), { terms: { mode: "checkbox" } });
    expect(box).toContain('type="checkbox"');
    // The confirm button waits for the tick (the server checks it again).
    expect(box).toMatch(/<button type="submit" disabled=""[^>]*>Confirm the exchange/);
  });
});

describe("ExchangeView: the other states", () => {
  it("the pay step shows what to pay now, until when, and one button with the amount to Stripe's page", () => {
    const markup = draw(found("to_pay", exchange({ status: "processed", exchangeOrderId: "o2", exchangeOrderNumber: "1050" }), null));
    const text = words(markup);
    expect(text).toContain(en.payIntro);
    expect(text).toMatch(/To pay now: NOK\s?149\.00/);
    expect(text).toMatch(/If you do not pay by 14 October 2026.*you get your money back as usual\./);
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(text).toMatch(/Pay NOK\s?149\.00/);
    expect(text).toContain(en.payNote);
    expect(markup).not.toContain('type="checkbox"');
  });

  it("each ended or waiting state is one plain sentence with no button", () => {
    const cases: [ExchangePageFound["state"], string][] = [
      ["confirmed", en.confirmed],
      ["processing", en.confirmed],
      ["done", en.states.done("1050")],
      ["expired", en.states.expired],
      ["cancelled", en.states.cancelled],
      ["refunded", en.states.refunded],
      ["declined", en.declined],
      ["payments_off", en.states.paymentsOff],
      ["too_small", en.tooSmall],
    ];
    for (const [state, sentence] of cases) {
      const markup = draw(found(state, exchange({ exchangeOrderNumber: "1050" }), null));
      const text = words(markup);
      expect(text, state).toContain(sentence);
      expect(markup, state).not.toContain("<button");
      // Nothing of the goods or amounts once it is not waiting for an answer.
      expect(text, state).not.toContain("Ullgenser");
      expect(text, state).toContain("Questions? Write to Demo Butikk at hei@demo.test.");
      expect(markup, state).toContain('role="status"');
    }
    // A confirmed exchange with a difference says it will be asked for after processing; nothing is charged by confirming.
    expect(words(draw(found("confirmed")))).toMatch(/You will be asked to pay NOK\s?149\.00 then\./);
  });

  it("is said in Norwegian, Swedish and Danish by hand, and in the currency of the order even in a euro view", () => {
    for (const lang of ["nb", "sv", "da"]) {
      const x = t(lang).exchange;
      const text = words(draw(found("proposed"), { lang }));
      expect(text, lang).toContain(x.confirm);
      expect(text, lang).toContain(x.decline);
      expect(text, lang).toContain(x.agreement);
      expect(words(draw(found("expired"), { lang })), lang).toContain(x.states.expired);
    }
    // An exchange shown in a euro view of the market is in the order's euro (D109: never converted again).
    const euro = words(draw(found("proposed", exchange({ currency: "EUR" }, 6490, 5000)), { lang: "en" }));
    expect(euro).toMatch(/You pay €\s?14\.90|You pay EUR\s?14\.90/);
  });
});
