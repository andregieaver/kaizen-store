import type { PackPictureOf } from "./pack-designs";
import type { PageRow } from "./page-content";
import type { SavedPart } from "./saved-parts";

/**
 * A theme's own sections (D272, `docs/signature-themes.md` step 4): the rows its designed pages are made of, offered in the page builder
 * while the theme is live, so an owner can put a theme's hero or band on a page of their own with one press. A section brings words
 * written for any store (never its demo store's) and links to the store's own products; its pictures are the theme's demo store's,
 * named by slot and copied into the store's library when it is placed. Pure.
 */
export type ThemeSection = {
  /** Stable for the theme: how a press names it to the server. */
  key: string;
  name: string;
  /** What it holds, in a line. */
  description: string;
  /** The slot of the picture its tile shows, or null for words only. */
  thumb: string | null;
  row: PageRow;
};

/** A theme's sections, made with the pictures given (a slot's picture, or null). */
export type ThemeSections = (picture: PackPictureOf) => ThemeSection[];

/** A section of a theme by its key, made with the pictures given, or null. */
export function themeSection(sections: ThemeSections | undefined, key: string, picture: PackPictureOf): ThemeSection | null {
  return sections?.(picture).find((section) => section.key === key) ?? null;
}

/** A theme section as the builder's Rows tab lists it: its key, name, line and the picture its tile shows. */
export type SectionTile = { key: string; name: string; description: string; thumb: string | null };
/** The live theme's sections for the builder, or null where the live theme has none. */
export type ThemeSectionsOffer = { theme: string; sections: SectionTile[] } | null;
/** A section made ready for a page (a saved row the builder places as it places a template), or why not. */
export type SectionResult = { ok: true; part: SavedPart } | { ok: false; problem: string };
