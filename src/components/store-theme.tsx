import { siteFontFamilies, type SiteFonts } from "@/lib/fonts";
import { themeCss, type StoreTheme } from "@/lib/theme";

import { FontLinks } from "./font-links";

/** A short name for a stylesheet's text, so a changed theme is a new stylesheet to React. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * A store's look in the head of each of its pages (D60): its fonts from
 * Kaizen's copies (D59) and its theme's colours and sizes. The `<html>`
 * carries the theme's choices (`themeAttributes`).
 */
export function StoreThemeStyles({ store }: { store: { id: string; theme: StoreTheme; fonts: SiteFonts } }) {
  const css = themeCss(store.theme.settings, "html[data-store-theme]");
  return (
    <>
      <FontLinks families={siteFontFamilies(store.fonts)} />
      <style href={`theme-${store.id}-${hash(css)}`} precedence="theme">
        {css}
      </style>
    </>
  );
}
