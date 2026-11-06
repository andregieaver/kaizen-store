import { PACK_DEMO_WORDS, PACK_KEYS } from "./content-packs";
import type { DesignCard } from "./design-presets";
import type { PlatformMessages } from "./messages/platform-en";
import type { PlatformLang } from "./platform-lang";

/**
 * Sign-up's look cards in `lang` (D273, D312): the Standard card's line, each theme's summary and description in its own words where they are
 * written in that language (`listing.words`, as the theme store shows them), and the demo store a look starts with said there
 * ("Far Light, en demobutikk med trykk av nattehimmelen"). English is the cards as they are. Pure.
 */
export function designCardsIn(cards: DesignCard[], lang: PlatformLang, words: PlatformMessages["themeCards"]): DesignCard[] {
  if (lang === "en") return cards;
  // A look's demo store is its name and its pack's words (`contentShowcase()`): the words are said in the language where they are written.
  const demo = (line: string | null | undefined) => {
    if (!line) return line;
    for (const key of PACK_KEYS) {
      const tail = `, ${PACK_DEMO_WORDS[key]}`;
      const said = words.packDemo[key];
      if (said && line.endsWith(tail)) return `${line.slice(0, -tail.length)}, ${said}`;
    }
    return line;
  };
  return cards.map((card) => {
    const own = card.words?.[lang];
    return {
      ...card,
      summary: card.id === "" ? words.standardSummary : (own?.summary ?? card.summary),
      description: own?.description ?? card.description,
      ...(card.demo !== undefined && { demo: demo(card.demo) }),
      ...(card.looks && { looks: card.looks.map((look) => ({ ...look, ...(look.demo !== undefined && { demo: demo(look.demo) }) })) }),
    };
  });
}
