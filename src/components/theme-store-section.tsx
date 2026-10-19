import { Suspense } from "react";

import type { ThemeStoreBlock } from "@/lib/page-content";
import { parseThemeFilter, type ThemeFilter, type ThemeStoreCard } from "@/lib/theme-store";
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
  if (block.part === "list") {
    const cards = await themeStoreCards();
    // The unfiltered list is the fallback, so search engines and a first visit read every theme at once; the filters are the address's.
    if (!place.query) return <ThemeStoreList cards={cards} filter={NO_FILTER} />;
    return (
      <Suspense fallback={<ThemeStoreList cards={cards} filter={NO_FILTER} />}>
        <Filtered cards={cards} query={place.query} />
      </Suspense>
    );
  }
  if (!place.themeSlug) return null;
  const theme = await themeStorePage(place.themeSlug);
  if (!theme) return null;
  const words = { heading: block.heading, text: block.text };
  switch (block.part) {
    case "stage":
      return <ThemeStagePart theme={theme} />;
    case "live":
      return <ThemeLivePart theme={theme} heading={words.heading ?? ""} text={words.text ?? ""} />;
    case "highlights":
      return <ThemeHighlightsPart theme={theme} heading={words.heading ?? ""} />;
    case "pictures":
      return <ThemePicturesPart theme={theme} />;
    case "features":
      return <ThemeFeaturesPart theme={theme} heading={words.heading ?? ""} text={words.text ?? ""} />;
    case "details":
      return <ThemeDetailsPart theme={theme} heading={words.heading ?? ""} />;
  }
}

async function Filtered({ cards, query }: { cards: ThemeStoreCard[]; query: NonNullable<GridPlace["query"]> }) {
  return <ThemeStoreList cards={cards} filter={parseThemeFilter(await query)} />;
}
