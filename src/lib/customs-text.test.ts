import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderCustomsNote, OrderCustomsRows } from "@/components/order-customs";

import { cartCustomsSentences, customsText, orderCustomsSentence } from "./customs-text";
import type { OrderCustoms } from "./duties";

const money = (minor: number) => `€${(minor / 100).toFixed(2)}`;
const record = (over: Partial<OrderCustoms> = {}): OrderCustoms => ({
  v: 1,
  mode: "ddp",
  chosen: "ddp",
  fallback: null,
  destination: "GB",
  currency: "EUR",
  collectedMinor: 3024,
  estimate: { dutyMinor: 2520, importVatMinor: 4704, dapMinor: 7224, verified: false, sources: [] },
  reason: null,
  on: "2026-10-27",
  ...over,
});
const text = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("what a shopper reads about customs (D343)", () => {
  it("is written by hand in Norwegian, Swedish, Danish and English, and English for any other language", () => {
    expect(customsText("nb-NO").dutiesLine).toBe("Toll og importavgifter");
    expect(customsText("sv").dutiesLine).toBe("Tull och importskatter");
    expect(customsText("da").dutiesLine).toBe("Told og importafgifter");
    expect(customsText("de").dutiesLine).toBe("Duties and import taxes");
  });

  it("says on the order who pays, with the amount collected or the estimate", () => {
    const en = customsText("en");
    expect(orderCustomsSentence(record(), en, money)).toBe("Duties and import taxes paid at checkout: €30.24.");
    expect(orderCustomsSentence(record({ mode: "dap", collectedMinor: 0 }), en, money)).toMatch(/paid by the recipient to the carrier on delivery: about €72\.24 by our estimate/);
    expect(orderCustomsSentence(record({ mode: "dap", collectedMinor: 0, estimate: null, reason: "missing_hs" }), en, money)).toBe(en.orderDap);
    expect(orderCustomsSentence(null, en, money)).toBeNull();
  });

  it("says in the cart what blocks DDP, or what the carrier may collect", () => {
    const en = customsText("en");
    expect(cartCustomsSentences({ mode: "ddp", blocked: true, estimate: { kind: "unknown", reason: "no_rate", lines: [] } }, en, money)).toEqual([{ text: en.noEstimate, problem: true }]);
    expect(cartCustomsSentences({ mode: "dap", blocked: false, estimate: { kind: "estimate", dapMinor: 0 } }, en, money)).toEqual([{ text: en.dapNothing, problem: false }]);
    expect(cartCustomsSentences({ mode: "dap", blocked: false, estimate: { kind: "none" } }, en, money)).toEqual([]);
  });

  it("draws the duties as a row after the total on the order page, and nothing for an order without", () => {
    const rows = text(renderToString(createElement(OrderCustomsRows, { order: { totalMinor: 25_000, dutiesMinor: 3024, customs: record() }, lang: "en", money, paidLabel: "To pay" })));
    expect(rows).toContain("Duties and import taxes (estimate) €30.24");
    expect(rows).toContain("To pay €280.24");
    expect(renderToString(createElement(OrderCustomsRows, { order: { totalMinor: 25_000 }, lang: "en", money, paidLabel: "To pay" }))).toBe("");
    expect(text(renderToString(createElement(OrderCustomsNote, { order: { totalMinor: 25_000, customs: record() }, lang: "nb", money })))).toContain("Toll og importavgifter betalt i kassen: €30.24.");
  });
});
