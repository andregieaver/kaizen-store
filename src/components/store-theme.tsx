import { siteFontFamilies } from "@/lib/fonts";
import { type SiteFonts } from "@/lib/fonts-schema";
import { STORE_THEME_SELECTOR, themeCss, type StoreTheme } from "@/lib/theme";

import { breakpointsOf, type Breakpoints } from "@/lib/breakpoints";
import { breakpointClassCss } from "@/lib/part-css";

import { FontLinks } from "./font-links";
import { FontPreloads } from "./font-preloads";
import { BreakpointSheet } from "./part-styles";

/** A short name for a stylesheet's text, so a changed theme is a new stylesheet to React. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * A store's look in the head of each of its pages (D60): its fonts from
 * Kaizen's copies (D59), their files preloaded (`FontPreloads`), and its theme's colours and sizes. The `<html>`
 * carries the theme's choices (`themeAttributes`). Its screen sizes' breakpoint
 * classes (D179) serve what is drawn outside a page's rows: the standard header,
 * the listing, the gallery.
 */
export function StoreThemeStyles({ store, rowSizes }: { store: { id: string; theme: StoreTheme; fonts: SiteFonts }; rowSizes?: Breakpoints }) {
  const css = themeCss(store.theme.settings, STORE_THEME_SELECTOR);
  return (
    <>
      <FontPreloads families={siteFontFamilies(store.fonts)} />
      <FontLinks families={siteFontFamilies(store.fonts)} />
      <BreakpointSheet breakpoints={breakpointsOf(store.theme.settings)} />
      {/* Rows on Kaizena Flow's own pages are drawn at the default sizes (owner null), so its layouts pass the defaults and keep
          that sheet if the theme's sizes ever differ. Store layouts pass nothing. */}
      {rowSizes && breakpointClassCss(rowSizes, "media") !== breakpointClassCss(breakpointsOf(store.theme.settings), "media") && <BreakpointSheet breakpoints={rowSizes} />}
      <style href={`theme-${store.id}-${hash(css)}`} precedence="theme">
        {css}
      </style>
    </>
  );
}
