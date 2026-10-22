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
  madeCard: null,
  madeShare: null,
  presets: [],
  looks: [{ key: null, name: id.toUpperCase(), showcase: null }],
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

  it("pictures each card by the admin's picture, else the card made from its photograph, else its colours (D274: never a hand-made shot of the Standard store)", () => {
    const made = "https://x.supabase.co/storage/v1/object/public/product-media/platform/theme-shots/t/u/computer-card.webp";
    const html = draw([card("calm", { pictureUrl: "/own.webp", madeCard: made }), card("fjord", { madeCard: made }), card("plain")]);
    expect(html).toContain('src="/own.webp"');
    expect(html.match(new RegExp(made.replaceAll(".", "\\."), "g"))?.length).toBe(1);
    expect(html.match(/<img /g)?.length).toBe(2);
    // The theme without either is drawn from its colours.
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><span[^>]*>PLAIN<\/span>/);
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

  it("dots each look in its own colours on a theme with presets, and none on a theme without (D275)", () => {
    const swatch = (accent: string) => ({ background: "#ffffff", surface: "#eeeeee", text: "#111111", accent, accentText: "#ffffff", heading: null });
    const looks = [
      { key: null, name: "CALM", showcase: null, swatch: swatch("#aa0000") },
      { key: "coast", name: "Coast", showcase: null, swatch: swatch("#0000aa") },
    ];
    const html = draw([card("calm", { looks, presets: [{ key: "coast", name: "Coast" }] }), card("plain")]);
    expect(html.match(/data-look-swatches/g)?.length).toBe(1);
    expect(html).toContain("#aa0000 50% 100%");
    expect(html).toContain("#0000aa 50% 100%");
    expect(html).toContain("2 presets");
  });
});

describe("the theme store's list in Norwegian (D312 P3)", () => {
  it("draws its words, filters and links in Norwegian, and marks a theme's words it has only in English", async () => {
    const { inLanguage } = await import("@/lib/theme-store");
    const calm = card("calm", {
      listing: { kinds: [], styles: ["minimal"], pictures: [], words: { nb: { summary: "Rolig og nøytral." } } },
      prices: [{ currency: "NOK", amountMinor: 349000 }],
    });
    const cards = [inLanguage(calm, "nb"), inLanguage(card("fjord"), "nb")];
    const html = renderToStaticMarkup(createElement(ThemeStoreList, { cards, filter: none, lang: "nb" })).replaceAll("<!-- -->", "");
    expect(html).toContain('href="/no/themes/calm"');
    expect(html).toContain('aria-label="Filtrer temaer"');
    expect(html).toContain("2 temaer");
    expect(html).not.toContain("alle gratis");
    expect(html).toContain("Minimalistisk");
    expect(html).toContain("Rolig og nøytral.");
    expect(html).toContain("3 490 kr");
    expect(html).toContain('lang="en">About fjord.');
    expect(html).toContain('href="/no/themes?kind=fashion"');
  });
});
