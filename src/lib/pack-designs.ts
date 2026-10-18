import type { PackPicture } from "./content-pack-pages";
import type { ContentPack } from "./content-packs";
import type { PageContent } from "./page-content";
import { arcadeAboutPage, arcadeHomePage } from "./signature/arcade";
import { atelierAboutPage, atelierHomePage } from "./signature/atelier";
import { botanicaAboutPage, botanicaHomePage } from "./signature/botanica";
import { kineticAboutPage, kineticHomePage } from "./signature/kinetic";
import { orbitAboutPage, orbitHomePage } from "./signature/orbit";

/**
 * Pages designed for a signature theme's demo store (`docs/signature-themes.md` step 1): its home and about pages, built from its pack's
 * words and pictures in rows the theme draws as no other theme does, in place of the common pages (`packHomePage()`). Pure; checked by
 * `pageInput` where they are saved.
 */

/** A pack's picture by slot, null while it has none. */
export type PackPictureOf = (slot: string) => PackPicture | null;

export type PackDesign = {
  home: (pack: ContentPack, picture: PackPictureOf) => PageContent;
  about: (pack: ContentPack, picture: PackPictureOf) => PageContent;
};

export const PACK_DESIGNS = {
  orbit: { home: orbitHomePage, about: orbitAboutPage },
  atelier: { home: atelierHomePage, about: atelierAboutPage },
  arcade: { home: arcadeHomePage, about: arcadeAboutPage },
  botanica: { home: botanicaHomePage, about: botanicaAboutPage },
  kinetic: { home: kineticHomePage, about: kineticAboutPage },
} as const satisfies Record<string, PackDesign>;

export type PackDesignKey = keyof typeof PACK_DESIGNS;
