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
  madeCard: null,
  madeShare: null,
  presets: [],
  looks: [{ key: null, name: id.toUpperCase(), showcase: null }],
  listing: { kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} },
  features: [],
  swatch: { background: "#ffffff", surface: "#eeeeee", text: "#111111", accent: "#222222", accentText: "#ffffff", heading: "Lora" },
  ...extra,
});
const none: ThemeFilter = { kind: null, style: null, feature: null };
const draw = (cards: ThemeStoreCard[], filter: ThemeFilter = none) => renderToStaticMarkup(createElement(ThemeStoreList, { cards, filter })).replaceAll("<!-- -->", "");

describe("the theme store's list", () => {
  it("links each theme to its page, says it is free, and counts them", () => {
    const html = draw([card("calm", { listing: { kinds: [], styles: ["minimal"], pictures: [], pack: null, presetPacks: {} } }), card("fjord")]);
    expect(html).toContain('href="/themes/calm"');
    expect(html).toContain("2 themes, all free");
    expect(html).toContain("Free");
    expect(html).toContain("Minimal");
  });

  it("filters by the address, with each filter a link and the chosen one marked", () => {
    const html = draw([card("calm", { listing: { kinds: ["food"], styles: [], pictures: [], pack: null, presetPacks: {} } }), card("signal", { listing: { kinds: ["fashion"], styles: [], pictures: [], pack: null, presetPacks: {} } })], { ...none, kind: "food" });
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
    const chosen = draw([card("calm", { listing: { kinds: [], styles: ["bold"], pictures: [], pack: null, presetPacks: {} } })], { ...none, style: "bold" });
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

  it("prefers the card made from its own look's photograph to the launch photograph, and the admin's picture to both (docs/theme-showcase-phase-2.md)", () => {
    const made = "https://x.supabase.co/storage/v1/object/public/product-media/platform/theme-shots/t/u/computer-card.webp";
    const html = draw([card("calm", { madeCard: made, shotUrl: "/demo/themes/calm-v2.webp" }), card("fjord", { pictureUrl: "/own.webp", madeCard: made })]);
    expect(html).toContain(`src="${made}"`);
    expect(html).not.toContain("calm-v2.webp");
    expect(html).toContain('src="/own.webp"');
    expect(html.match(new RegExp(made.replaceAll(".", "\\."), "g"))?.length).toBe(1);
  });

  it("names the trades a theme's looks are shown on, and nothing while none is", () => {
    const showcase = (pack: "food" | "home", trade: string) => ({ pack, trade, line: "", starterId: "x" });
    const looks = [
      { key: null, name: "Hearth", showcase: showcase("food", "Food and drink") },
      { key: "olive", name: "Olive", showcase: showcase("home", "Home") },
      { key: "blush", name: "Blush", showcase: null },
    ];
    expect(draw([card("hearth", { looks })])).toContain("Shown on food and drink and home stores");
    expect(draw([card("calm")])).not.toContain("Shown on");
    expect(draw([card("signal", { looks: [{ key: null, name: "Signal", showcase: { pack: "electronics", trade: "Electronics", line: "", starterId: "x" } }] })])).toContain(
      "Shown on an electronics store",
    );
  });

  it("says how many presets a theme has, its own look counted", () => {
    expect(draw([card("calm", { presets: [{ key: "coast", name: "Coast" }] })])).toContain("· 2 presets");
    expect(draw([card("calm")])).not.toContain("presets");
  });

  it("says when nothing matches, and when there is nothing yet", () => {
    expect(draw([card("calm")], { ...none, style: "bold" })).toContain("No theme matches all of these.");
    expect(draw([])).toContain("No themes yet.");
  });
});
