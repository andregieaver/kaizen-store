import { SIZES, type Size } from "./breakpoints";
import type { SiteBlock, SwitcherLayout, SwitcherText } from "./page-content";
import { valueAt } from "./responsive";

/**
 * The language switcher (D474): the site part *Languages* in a store's header or footer, as in Kaizena Flow's own (D312). Each language is
 * a link to the page the visitor is on in that language; how they are laid out (side by side, one under another, a drop-down list), with
 * which words (the language's name, its short code, none) and whether with a flag can each differ by screen size (`at`, D179). The page
 * is drawn once with all of it, and the part stylesheet shows what each size asks (`languageSwitchStyle()` in `part-css.ts`). Pure.
 */

/** What the switcher shows at one screen size. */
export type SwitcherLook = { layout: SwitcherLayout; text: SwitcherText; flag: boolean };

/**
 * The switcher's look at a size: as set there or at a larger size, else side by side, by name, without flags. A language with neither
 * words nor a flag could not be seen or chosen, so no words and no flag is its short code.
 */
export function switcherAt(block: Pick<SiteBlock, "switcher" | "langText" | "langFlag" | "at">, size: Size): SwitcherLook {
  const layout = valueAt(block, "switcher", size) ?? "row";
  const flag = valueAt(block, "langFlag", size) ?? false;
  const text = valueAt(block, "langText", size) ?? "name";
  return { layout, flag, text: text === "none" && !flag ? "code" : text };
}

/** The sizes at which a look holds. */
export const sizesWhere = (block: Pick<SiteBlock, "switcher" | "langText" | "langFlag" | "at">, test: (look: SwitcherLook) => boolean): Size[] =>
  SIZES.filter((size) => test(switcherAt(block, size)));
