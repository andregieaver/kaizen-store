import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { platformEn } from "@/lib/admin-messages/platform.en";
import { platformNb } from "@/lib/admin-messages/platform.nb";
import { formatMoney } from "@/lib/money";
import type { PlatformRivalPrice } from "@/server/market-rivals";

import { PlatformRivalsCard, type PlatformRivalsCardProps } from "./platform-rivals-card";

/** Other store platforms' prices on Platform → Plans (D900 M4): each with the difference worked out by code and what code found on its page. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const action = async () => ({ status: "ok" as const, messages: [] });

const price = (over: Partial<PlatformRivalPrice> = {}): PlatformRivalPrice => ({
  id: "11111111-1111-4111-8111-111111111111",
  platform: "Shopify",
  plan: "Basic",
  priceMinor: 2900,
  currency: "EUR",
  interval: "month",
  feeBps: 200,
  planId: "22222222-2222-4222-8222-222222222222",
  planName: "Starter",
  oursMinor: 3900,
  source: "https://www.shop.example/pricing",
  checkedOn: "2026-11-25",
  onPage: true,
  goneAt: null,
  ...over,
});

const props = (over: Partial<PlatformRivalsCardProps> = {}): PlatformRivalsCardProps => ({
  lang: "en",
  locale: "en-GB",
  w: platformEn.plans.rivals,
  prices: [price()],
  plans: [{ id: "22222222-2222-4222-8222-222222222222", name: "Starter" }],
  currencies: ["EUR", "NOK", "USD"],
  actions: { keep: action, remove: action },
  ...over,
});

describe("other platforms' prices on Platform → Plans (D900 M4)", () => {
  it("shows each price against Kaizena Flow's plan, its fee, when it was checked and its page", () => {
    const out = html(h(PlatformRivalsCard, props()));
    expect(out).toContain("Shopify Basic");
    expect(out).toContain(`${formatMoney(2900, "EUR", "en-GB")} a month`);
    expect(out).toContain("2.0 % of each sale");
    expect(out).toContain(`against your Starter at ${formatMoney(3900, "EUR", "en-GB")} a month: you are 34 % dearer`);
    expect(out).toContain("Checked 25 Nov 2026");
    expect(out).toContain("On its page");
    expect(out).toContain('href="https://www.shop.example/pricing"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    // Adding is a step in while there are prices.
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/);
  });

  it("says when its page could not be read, when the price is not found, and when it is gone and needs a person", () => {
    const out = html(
      h(
        PlatformRivalsCard,
        props({
          prices: [
            price({ id: "a", plan: "Unread", onPage: null }),
            price({ id: "b", plan: "Missing", onPage: false }),
            price({ id: "c", plan: "Gone", onPage: false, goneAt: "2026-11-24T10:00:00Z" }),
            price({ id: "d", plan: "Other currency", currency: "USD", oursMinor: null, feeBps: null }),
          ],
        }),
      ),
    );
    expect(out).toContain("Page not read");
    expect(out).toContain("Not found on its page");
    expect(out).toContain("Gone from its page: check it");
    expect(out).toContain("no price of yours to compare in that currency");
    expect(out).toContain("no fee stated");
  });

  it("opens the form when nothing is kept, and leaves the forms out for a reader", () => {
    const empty = html(h(PlatformRivalsCard, props({ prices: [] })));
    expect(empty).toContain("No other platform's price yet");
    expect(empty).toMatch(/<details[^>]*\bopen\b/);
    const reader = html(h(PlatformRivalsCard, props({ actions: null })));
    expect(reader).not.toContain("Keep the price");
    expect(reader).not.toContain(">Remove<");
  });

  it("reads in Norwegian", () => {
    const out = html(h(PlatformRivalsCard, props({ lang: "nb", locale: "nb-NO", w: platformNb.plans.rivals })));
    expect(out).toContain("Andre plattformers priser");
    expect(out).toContain("du er 34 % dyrere");
    expect(out).toContain("Står på siden");
  });
});
