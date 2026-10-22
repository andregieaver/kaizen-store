import { Suspense } from "react";

import type { ThemeStoreBlock } from "@/lib/page-content";
import type { PlatformLang } from "@/lib/platform-lang";
import { inLanguage, parseThemeFilter, type ThemeFilter, type ThemeStoreCard } from "@/lib/theme-store";
import type { GridPlace } from "@/server/content-grid";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";

import { ThemeDetailsPart, ThemeFeaturesPart, ThemeHighlightsPart, ThemeLivePart, ThemePicturesPart, ThemeStagePart } from "./theme-page-parts";
import { ThemeStoreList } from "./theme-store-view";

const NO_FILTER: ThemeFilter = { kind: null, style: null, feature: null };

/**
 * A theme store component on one of Kaizena Flow's pages (D285): the themes, read where the page is shown (cached, refreshed when a
 * theme is published), or a part of a theme's page for the theme the address names (`GridPlace.themeSlug`, given only by the route of a
 * theme's page). Anywhere else a theme's part draws nothing, as does any part on a store's page.
 */
export async function ThemeStoreSection({ block, place }: { block: ThemeStoreBlock; place: GridPlace }) {
  if (place.owner !== null) return null;
  // The page's language (D312 P3): the cards and parts in it, the theme's own words where it has them in it.
  const lang = place.lang ?? "en";
  if (block.part === "list") {
    const cards = (await themeStoreCards()).map((card) => inLanguage(card, lang));
    // The unfiltered list is the fallback, so search engines and a first visit read every theme at once; the filters are the address's.
    if (!place.query) return <ThemeStoreList cards={cards} filter={NO_FILTER} lang={lang} />;
    return (
      <Suspense fallback={<ThemeStoreList cards={cards} filter={NO_FILTER} lang={lang} />}>
        <Filtered cards={cards} query={place.query} lang={lang} />
      </Suspense>
    );
  }
  if (!place.themeSlug) return null;
  const found = await themeStorePage(place.themeSlug);
  if (!found) return null;
  const theme = inLanguage(found, lang);
  const words = { heading: block.heading, text: block.text, lang };
  switch (block.part) {
    case "stage":
      return <ThemeStagePart theme={theme} lang={lang} />;
    case "live":
      return <ThemeLivePart theme={theme} {...words} heading={words.heading ?? ""} text={words.text ?? ""} />;
    case "highlights":
      return <ThemeHighlightsPart theme={theme} {...words} heading={words.heading ?? ""} />;
    case "pictures":
      return <ThemePicturesPart theme={theme} lang={lang} />;
    case "features":
      return <ThemeFeaturesPart theme={theme} {...words} heading={words.heading ?? ""} text={words.text ?? ""} />;
    case "details":
      return <ThemeDetailsPart theme={theme} {...words} heading={words.heading ?? ""} />;
  }
}

async function Filtered({ cards, query, lang }: { cards: ThemeStoreCard[]; query: NonNullable<GridPlace["query"]>; lang: PlatformLang }) {
  return <ThemeStoreList cards={cards} filter={parseThemeFilter(await query)} lang={lang} />;
}
