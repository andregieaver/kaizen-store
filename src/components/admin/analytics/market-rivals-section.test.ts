import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { marketCheckEn } from "@/lib/admin-messages/market-check.en";
import type { KeptOffer, Rival } from "@/server/market-rivals";

import { MarketRivalsSection, type MarketRivalsProps } from "./market-rivals-section";

/** Analytics → Markets' rivals (D900 M2): the owner's rivals, the forms, and each offer against the store's own price. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const action = async () => ({ status: "ok" as const, messages: [] });
const now = new Date("2026-11-25T12:00:00Z");

const rival: Rival = { id: "11111111-1111-4111-8111-111111111111", market: "NO", name: "Linnet", host: "linnet.example", createdAt: "2026-11-20" };
const offer = (over: Partial<KeptOffer> = {}): KeptOffer => ({
  id: "22222222-2222-4222-8222-222222222222",
  rivalId: rival.id,
  rivalName: "Linnet",
  host: "linnet.example",
  market: "NO",
  address: "https://linnet.example/p/apron",
  name: "Linen apron",
  productId: "33333333-3333-4333-8333-333333333333",
  productName: "Forkle i lin",
  priceMinor: 40000,
  currency: "NOK",
  highPriceMinor: null,
  availability: "in_stock",
  shippingMinor: null,
  shippingCurrency: null,
  deliveryDaysMin: null,
  deliveryDaysMax: null,
  returnDays: 30,
  readAt: "2026-11-24T10:00:00Z",
  own: { priceMinor: 46000, currency: "NOK" },
  ...over,
});

const props = (over: Partial<MarketRivalsProps> = {}): MarketRivalsProps => ({
  lang: "en",
  locale: "nb-NO",
  timeZone: "Europe/Oslo",
  words: marketCheckEn.rivals,
  rivals: [rival],
  offers: [offer(), offer({ id: "44444444-4444-4444-8444-444444444444", address: "https://linnet.example/p/bowl", name: "Bowl", productId: null, own: null, readAt: "2026-10-01T10:00:00Z" })],
  countries: [{ code: "NO", name: "Norway" }],
  products: [{ handle: "apron", title: "Forkle i lin" }],
  actions: { add: action, remove: action, read: action },
  now,
  ...over,
});

describe("rivals on Analytics → Markets (D900 M2)", () => {
  it("lists the owner's rivals with the forms, and each offer against the store's own price", () => {
    const out = html(h(MarketRivalsSection, props()));
    expect(out).toContain('data-rival="linnet.example"');
    expect(out).toContain("Add rival");
    expect(out).toContain("Read the page");
    expect(out).toContain('href="https://linnet.example/p/apron"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    // 460 kr against 400 kr: the store is 15 % dearer, worked out by code.
    expect(out).toContain("+15 %");
    // An offer held against no product of the store's is not comparable, and one read over 30 days ago is old.
    expect(out).toContain("Not comparable");
    expect(out).toContain("Old");
  });

  it("says what to do with no rival yet, and draws no form for a member who may only read", () => {
    const empty = html(h(MarketRivalsSection, props({ rivals: [], offers: [] })));
    expect(empty).toContain("No rivals yet.");
    expect(empty).not.toContain("Read the page");
    const reader = html(h(MarketRivalsSection, props({ actions: null })));
    expect(reader).not.toContain("Add rival");
    expect(reader).not.toContain(">Remove<");
    expect(reader).toContain("Linen apron");
  });
});
