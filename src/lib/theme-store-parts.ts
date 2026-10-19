/**
 * The theme store's own components (D285): the parts of `/themes` and of a theme's page `/themes/{slug}` that come from the themes
 * themselves, so both pages can be built in Kaizena Flow's page builder around them. The list of themes may be on any of Kaizena Flow's
 * pages; the rest draw only on the page chosen for a theme's page, for the theme its address names, and nothing anywhere else. Each
 * has its own heading and line, the page's words, drawn only when the part has something to show (a theme without highlights draws no
 * *Highlights*). No server code: the builder reads the names and words too.
 */

export const THEME_STORE_PARTS = ["list", "stage", "live", "highlights", "pictures", "features", "details"] as const;
export type ThemeStorePart = (typeof THEME_STORE_PARTS)[number];

export const isThemeStorePart = (value: unknown): value is ThemeStorePart => (THEME_STORE_PARTS as readonly unknown[]).includes(value);

/** The parts of a theme's page: they draw for the theme the address names, so only on the page chosen for a theme's page. */
export const THEME_PAGE_PARTS = THEME_STORE_PARTS.filter((part) => part !== "list");

/** The longest heading and line a part takes. */
export const THEME_PART_HEADING_MAX = 200;
export const THEME_PART_TEXT_MAX = 500;

export const THEME_STORE_PART_COPY: Record<
  ThemeStorePart,
  {
    /** What the builder calls it. */
    name: string;
    /** What it draws, for its settings and its stand-in. */
    hint: string;
    /** The words a new one starts with; absent: the part takes no heading or no line. */
    heading?: string;
    text?: string;
  }
> = {
  list: {
    name: "Themes",
    hint: "Every published theme as a card, with the filters by kind of store, style and what it includes. A filter chosen is in the address, so a link can open the list filtered.",
  },
  stage: {
    name: "Theme preview",
    hint: "The theme's name, summary and presets, a computer and a phone showing the chosen look on its own content, and Use this theme, Preview and Try it in your store.",
  },
  live: {
    name: "See it live",
    hint: "The published demo stores wearing one of the theme's looks, each opening the store. Nothing shows when there is none.",
    heading: "See it live",
    text: "Demo stores wearing {theme}, with their own words, pictures and products.",
  },
  highlights: {
    name: "Highlights",
    hint: "The pictures made from the theme's photographs, with their words. Nothing shows for a theme without them.",
    heading: "Highlights",
  },
  pictures: {
    name: "Theme pictures",
    hint: "The theme's own pictures, chosen on its page in the admin. Nothing shows for a theme without them.",
  },
  features: {
    name: "What you get",
    hint: "What the theme includes, from its published version: its own header, footer, product page, presets and so on.",
    heading: "What you get",
    text: "Your words, pictures and products stay as they are when you switch.",
  },
  details: {
    name: "Details",
    hint: "Folded away: the theme's description, what kinds of store it suits, its style, section styles and version, and its changelog.",
    heading: "Details",
  },
};

/** Where theme store parts are drawn (a `GridPlace`): the theme the address names, and the parts with something for it. */
export type ThemePartPlace = { themeSlug?: string; themeParts?: readonly ThemeStorePart[] };

/**
 * Whether a part draws where a page is shown (D285): the list anywhere; a theme's part only for a theme the address names, and not when the
 * route knows it has nothing for that theme (`themePartsWith()`), so its row is left out of the page rather than left empty.
 */
export const themePartDraws = (part: ThemeStorePart, place: ThemePartPlace): boolean =>
  part === "list" || (Boolean(place.themeSlug) && (!place.themeParts || place.themeParts.includes(part)));

/**
 * The parts with something for a theme, as far as its page knows when it is drawn: its highlights, its own pictures and what it includes.
 * See it live is read every few minutes in its own hole of the page, so it counts as drawn.
 */
export function themePartsWith(theme: {
  highlights?: readonly unknown[];
  pictureUrl: string | null;
  listing: { pictures: readonly string[] };
  features: readonly unknown[];
}): ThemeStorePart[] {
  return THEME_STORE_PARTS.filter((part) =>
    part === "highlights"
      ? (theme.highlights?.length ?? 0) > 0
      : part === "pictures"
        ? Boolean(theme.pictureUrl) || theme.listing.pictures.length > 0
        : part === "features"
          ? theme.features.length > 0
          : true,
  );
}

/** A part's line with the theme's name where it says `{theme}`. */
export const withThemeName = (text: string, title: string) => text.replaceAll("{theme}", title);
