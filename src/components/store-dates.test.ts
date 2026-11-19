import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CampaignNotice } from "@/lib/campaign-notices";
import type { GridItem } from "@/lib/content-grid";
import { t } from "@/lib/i18n";
import { toMarket } from "@/lib/markets";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import type { ShopperFulfilment } from "@/server/fulfilment";

import { CampaignNotices } from "./campaign-notice";
import { ContentGridView } from "./content-grid";
import { OrderShipments } from "./order-shipments";

/**
 * The dates a shopper reads on a store's pages are the store's own (code review 1.14's next, FS11, D796): an article published, a campaign's
 * last day and a parcel sent in the evening fall on the store's day, wherever the server's clock is (UTC on Vercel) and whatever Oslo says.
 * 23:30 in New York on 3 October is 03:30 UTC on the 4th; 00:30 in Auckland on 4 October is 11:30 UTC on the 3rd.
 */

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const NY_EVENING = "2026-10-04T03:30:00.000Z";
const AUCKLAND_NIGHT = "2026-10-03T11:30:00.000Z";

describe("an article's day in a grid of articles", () => {
  const block = newBlock("contentGrid", () => "g1") as ContentGridBlock;
  const article = (date: string): GridItem => ({ id: "a", href: "/blog/a", title: "Autumn", excerpt: "", image: null, price: null, date });
  const html = (date: string, timeZone: string) =>
    text(renderToString(createElement(ContentGridView, { block, data: { items: [article(date)], lang: "en", locale: "en-US", timeZone } })));

  it("is the store's own day, not UTC's or Oslo's", () => {
    expect(html(NY_EVENING, "America/New_York")).toContain("October 3, 2026");
    expect(html(NY_EVENING, "Europe/Oslo")).toContain("October 4, 2026");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).toContain("October 4, 2026");
    expect(html(AUCKLAND_NIGHT, "America/New_York")).toContain("October 3, 2026");
  });

  it("shows a custom item's typed day as it is, in any zone", () => {
    expect(html("2026-10-03", "Pacific/Auckland")).toContain("October 3, 2026");
    expect(html("2026-10-03", "Pacific/Honolulu")).toContain("October 3, 2026");
  });
});

describe("a campaign's last day on a product's page", () => {
  const market = toMarket({ code: "US", currency: "USD", defaultLocale: "en-US" });
  const notice: CampaignNotice = {
    id: "n1",
    name: "Fall sale",
    kind: "percent",
    percent: 20,
    buyQuantity: 3,
    payQuantity: 2,
    giftTitle: null,
    thresholdMinor: null,
    amountMinor: null,
    tierBasis: null,
    tiers: [],
    bxgy: null,
    // 23:59 in New York on 3 October.
    endsAt: "2099-10-04T03:59:00.000Z",
    productIds: null,
    signIn: false,
  };
  const html = (timeZone: string) => text(renderToString(createElement(CampaignNotices, { notices: [notice], market, timeZone, m: t("en") })));

  it("ends on the store's own day", () => {
    expect(html("America/New_York")).toContain("October 3, 2099");
    expect(html("Europe/Oslo")).toContain("October 4, 2099");
  });
});

describe("a parcel sent in the evening, on the order page", () => {
  const fulfilment: ShopperFulfilment = {
    state: "sent",
    stillToCome: [],
    parcels: [
      { id: "p1", createdAt: NY_EVENING, carrier: "Posten", trackingNumber: "TN1", trackingUrl: null, legacy: false, lines: [{ lineId: "l1", sku: "MUG", title: "Mug", quantity: 1 }] },
    ],
  };
  const html = (timeZone: string) => text(renderToString(createElement(OrderShipments, { fulfilment, m: t("en"), locale: "en-US", timeZone })));

  it("is sent on the store's own day", () => {
    expect(html("America/New_York")).toContain("October 3, 2026");
    expect(html("Pacific/Auckland")).toContain("October 4, 2026");
  });
});
