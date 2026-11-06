import { describe, expect, it } from "vitest";

import { PACK_DEMO_WORDS, PACK_KEYS } from "./content-packs";
import { designCardsIn } from "./design-cards-lang";
import { keepDesignCard, type DesignCard } from "./design-presets";
import { platformEn } from "./messages/platform-en";
import { platformText } from "./platform-text";

const orbit: DesignCard = {
  id: "t1",
  title: "Orbit",
  summary: "A theme for the night sky.",
  description: "Made from scratch.",
  pictureUrl: null,
  previewHref: "/preview",
  demo: `Far Light, ${PACK_DEMO_WORDS.astronomy}`,
  looks: [{ key: "mars", name: "Mars", trade: null, starterId: null, demo: `Far Light, ${PACK_DEMO_WORDS.astronomy}`, previewHref: "/p" }],
  words: { nb: { summary: "Et tema for nattehimmelen.", description: "Laget fra bunnen av." } },
};
const plain: DesignCard = { id: "t2", title: "Calm", summary: "Quiet and neutral.", description: "", pictureUrl: null, previewHref: "/p", demo: "Own Shop" };

describe("sign-up's look cards in the page's language (D273, D312)", () => {
  it("leaves English as it is", () => {
    const cards = [keepDesignCard(), orbit];
    expect(designCardsIn(cards, "en", platformEn.themeCards)).toBe(cards);
  });

  it("says the Standard card, a theme's own words and the demo store in Norwegian", () => {
    const [standard, theme, other] = designCardsIn([keepDesignCard(), orbit, plain], "nb", platformText("nb").themeCards);
    expect(standard.summary).toBe(platformText("nb").themeCards.standardSummary);
    expect(theme).toMatchObject({ title: "Orbit", summary: "Et tema for nattehimmelen.", description: "Laget fra bunnen av." });
    expect(theme.demo).toBe("Far Light, en demobutikk med trykk av nattehimmelen");
    expect(theme.looks?.[0].demo).toBe("Far Light, en demobutikk med trykk av nattehimmelen");
    // A theme without Norwegian words, and a demo store that is not a content pack's, stay as written.
    expect(other).toMatchObject({ summary: "Quiet and neutral.", demo: "Own Shop" });
  });

  it("has every content pack's demo store in Norwegian", () => {
    const said = platformText("nb").themeCards.packDemo;
    for (const key of PACK_KEYS) expect(said[key], key).toBeTruthy();
  });
});
