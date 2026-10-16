import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ThemeFilter, ThemeStoreCard } from "@/lib/theme-store";

import { ThemeStoreList } from "./theme-store-view";

/** The theme store's list (`docs/theme-phase-3.md` step 1): a card per theme, free, under one bar of filters that are links. */
const card = (id: string, extra: Partial<ThemeStoreCard> = {}): ThemeStoreCard => ({
  id,
  slug: id,
  title: id.toUpperCase(),
  summary: `About ${id}.`,
  pictureUrl: null,
  shotUrl: null,
  listing: { kinds: [], styles: [], pictures: [] },
  features: [],
  swatch: { background: "#ffffff", surface: "#eeeeee", text: "#111111", accent: "#222222", accentText: "#ffffff", heading: "Lora" },
  ...extra,
});
const none: ThemeFilter = { kind: null, style: null, feature: null };
const draw = (cards: ThemeStoreCard[], filter: ThemeFilter = none) => renderToStaticMarkup(createElement(ThemeStoreList, { cards, filter })).replaceAll("<!-- -->", "");

describe("the theme store's list", () => {
  it("links each theme to its page, says it is free, and counts them", () => {
    const html = draw([card("calm", { listing: { kinds: [], styles: ["minimal"], pictures: [] } }), card("fjord")]);
    expect(html).toContain('href="/themes/calm"');
    expect(html).toContain("2 themes, all free");
    expect(html).toContain("Free");
    expect(html).toContain("Minimal");
  });

  it("filters by the address, with each filter a link and the chosen one marked", () => {
    const html = draw([card("calm", { listing: { kinds: ["food"], styles: [], pictures: [] } }), card("signal", { listing: { kinds: ["fashion"], styles: [], pictures: [] } })], { ...none, kind: "food" });
    expect(html).toContain('href="/themes/calm"');
    expect(html).not.toContain('href="/themes/signal"');
    const chosen = html.match(/<a [^>]*href="\/themes\?kind=food"[^>]*>/)?.[0] ?? "";
    expect(chosen).toContain('aria-current="page"');
    expect(html).toContain('href="/themes?kind=food&amp;style=bold"');
  });

  it("puts the filters in one bar of small menus that name the choice, with a way to clear them once one is chosen", () => {
    const plain = draw([card("calm")]);
    expect(plain.match(/<details/g)?.length).toBe(3);
    expect(plain).not.toContain("Clear filters");
    const chosen = draw([card("calm", { listing: { kinds: [], styles: ["bold"], pictures: [] } })], { ...none, style: "bold" });
    // The closed menu says what is chosen, and the bar clears every filter at once.
    expect(chosen).toMatch(/<summary[^>]*>[^]*?Style[^]*?Bold[^]*?<\/summary>/);
    expect(chosen).toMatch(/<a [^>]*href="\/themes"[^>]*>Clear filters<\/a>/);
  });

  it("pictures each card by the admin's picture, else its photograph, else its colours", () => {
    const html = draw([card("calm", { pictureUrl: "/own.webp", shotUrl: "/demo/themes/calm-v1.webp" }), card("fjord", { shotUrl: "/demo/themes/fjord-v1.webp" }), card("plain")]);
    expect(html).toContain('src="/own.webp"');
    expect(html).not.toContain("calm-v1.webp");
    expect(html).toContain('src="/demo/themes/fjord-v1.webp"');
    expect(html.match(/<img /g)?.length).toBe(2);
    // The theme without either is drawn from its colours.
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><span[^>]*>PLAIN<\/span>/);
  });

  it("says when nothing matches, and when there is nothing yet", () => {
    expect(draw([card("calm")], { ...none, style: "bold" })).toContain("No theme matches all of these.");
    expect(draw([])).toContain("No themes yet.");
  });
});
