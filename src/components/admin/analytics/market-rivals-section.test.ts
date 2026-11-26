import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { marketCheckEn } from "@/lib/admin-messages/market-check.en";
import { marketCheckNb } from "@/lib/admin-messages/market-check.nb";
import { formatCount } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import type { RivalSiteFacts } from "@/lib/market-rivals";
import type { KeptOffer, KeptServicePrice, Rival } from "@/server/market-rivals";

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
  previous: null,
  changedAt: null,
  own: { priceMinor: 46000, currency: "NOK" },
  ...over,
});

const site = (over: Partial<RivalSiteFacts> = {}): RivalSiteFacts => ({
  rivalId: rival.id,
  rivalName: "Linnet",
  market: "NO",
  host: "linnet.example",
  readAt: "2026-11-24T10:00:00Z",
  since: "2026-10-20T10:00:00Z",
  pages: 140,
  cut: false,
  problem: null,
  added: 9,
  gone: 2,
  section: "/blogg",
  newest: ["/blogg/r%C3%B8d-lin", "/blogg/vask"],
  ...over,
});

const props = (over: Partial<MarketRivalsProps> = {}): MarketRivalsProps => ({
  lang: "en",
  locale: "nb-NO",
  timeZone: "Europe/Oslo",
  words: marketCheckEn.rivals,
  rivals: [rival],
  sites: [site()],
  sells: true,
  services: { prices: [], per: marketCheckEn.finding.servicePer, currencies: ["NOK", "EUR"] },
  offers: [offer(), offer({ id: "44444444-4444-4444-8444-444444444444", address: "https://linnet.example/p/bowl", name: "Bowl", productId: null, own: null, readAt: "2026-10-01T10:00:00Z" })],
  countries: [{ code: "NO", name: "Norway" }],
  products: [{ handle: "apron", title: "Forkle i lin" }],
  actions: { add: action, remove: action, read: action, keepPrice: action, removePrice: action },
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

describe("rivals' sites on Analytics → Markets (D905)", () => {
  it("says under each rival what its site added and took down, where most went, and its newest pages, linked on its own site", () => {
    const out = html(h(MarketRivalsSection, props()));
    expect(out).toContain("140 pages · 9 added in 30 days · 2 gone · most under /blogg · Site read 24 Nov 2026");
    expect(out).toContain('href="https://linnet.example/blogg/r%C3%B8d-lin"');
    expect(out).toContain(">/blogg/rød-lin<");
  });

  it("says when its site is still to be read, was read only once, was too large to list whole, or could not be read", () => {
    const say = (s: Partial<RivalSiteFacts> | null) => html(h(MarketRivalsSection, props({ sites: s ? [site(s)] : [] })));
    expect(say(null)).toContain("Its site is read within a few minutes.");
    expect(say({ readAt: null })).toContain("Its site is read within a few minutes.");
    expect(say({ since: "2026-11-24T10:00:00Z", added: 0, gone: 0, newest: [] })).toContain("140 pages · First read 24 Nov 2026: what it adds shows from the next read.");
    expect(say({ cut: true, pages: 1000 })).toContain(`over ${formatCount(1000)} pages`);
    expect(say({ problem: "robots", pages: null })).toContain("Its robots.txt does not let us read its sitemap.");
    expect(say({ problem: "unread", pages: null, since: null })).toContain("No sitemap could be read on its site: tried 24 Nov 2026.");
    expect(say({ problem: "none", pages: null, since: null })).toContain("Its sitemap lists no pages: tried 24 Nov 2026.");
  });

  it("leaves out the offers and their reading for a store without a shop, and asks for rivals without products", () => {
    const out = html(h(MarketRivalsSection, props({ sells: false, products: [] })));
    expect(out).toContain("Add rival");
    expect(out).not.toContain("Read the page");
    expect(out).not.toContain("Linen apron");
    expect(out).toContain("9 added in 30 days");
    const empty = html(h(MarketRivalsSection, props({ sells: false, rivals: [], sites: [], offers: [] })));
    expect(empty).toContain("Add who you compete with, and what changes on their sites is followed every week.");
  });

  it("reads in Norwegian", () => {
    const out = html(h(MarketRivalsSection, props({ lang: "nb", words: marketCheckNb.rivals })));
    expect(out).toContain("140 sider · 9 lagt til på 30 dager · 2 borte · de fleste under /blogg");
    expect(out).toContain("Nyeste sider:");
  });
});

describe("rivals' published service prices on Analytics → Markets (D905 M5d)", () => {
  const price = (over: Partial<KeptServicePrice> = {}): KeptServicePrice => ({
    id: "55555555-5555-4555-8555-555555555555",
    rivalId: rival.id,
    rivalName: "Linnet",
    host: "linnet.example",
    market: "NO",
    service: "Linen workshop",
    priceMinor: 50000,
    currency: "NOK",
    per: "hour",
    own: { priceMinor: 60000, currency: "NOK" },
    productId: null,
    productName: null,
    source: "https://linnet.example/kurs",
    checkedOn: "2026-11-24",
    onPage: true,
    goneAt: null,
    ...over,
  });
  const services = (prices: KeptServicePrice[]) => ({ prices, per: marketCheckEn.finding.servicePer, currencies: ["NOK", "EUR"] });

  it("shows each price with what it is for, against the store's own, whether it is on its page, and its page", () => {
    const out = html(h(MarketRivalsSection, props({ sells: false, products: [], services: services([price()]) })));
    expect(out).toContain("Linnet: Linen workshop");
    expect(out).toContain(`${formatAmount(50000, "NOK", "nb-NO")} an hour`);
    expect(out).toContain(`you ask ${formatAmount(60000, "NOK", "nb-NO")} an hour: you are 20 % dearer · Checked 24 Nov 2026`);
    expect(out).toContain("On its page");
    expect(out).toContain('href="https://linnet.example/kurs"');
    // Keeping one is a step in while there are prices; without a shop there is no product to choose.
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>Keep a price/);
    expect(out).not.toContain("Or your product");
  });

  it("says when a page is unread, the price not found or gone, or the store gave none of its own", () => {
    const out = html(
      h(
        MarketRivalsSection,
        props({
          services: services([
            price({ id: "a", service: "Unread", onPage: null }),
            price({ id: "b", service: "Missing", onPage: false }),
            price({ id: "c", service: "Gone", onPage: false, goneAt: "2026-11-25T10:00:00Z" }),
            price({ id: "d", service: "Mine none", own: null }),
          ]),
        }),
      ),
    );
    expect(out).toContain("Page not read");
    expect(out).toContain("Not found on its page");
    expect(out).toContain("Gone from its page: check it");
    expect(out).toContain("no price of yours given");
  });

  it("opens the form while none is kept, offers a product with a shop, and is left out for Kaizena Flow's own store", () => {
    const open = html(h(MarketRivalsSection, props({ services: services([]) })));
    expect(open).toContain("No prices kept yet.");
    expect(open).toMatch(/<details[^>]*\bopen\b[^>]*>\s*<summary[^>]*>Keep a price/);
    expect(open).toContain("Or your product");
    const house = html(h(MarketRivalsSection, props({ services: null })));
    expect(house).not.toContain("Their published prices");
    const reader = html(h(MarketRivalsSection, props({ actions: null, services: services([price()]) })));
    expect(reader).not.toContain("Keep the price");
  });
});
