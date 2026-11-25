import "server-only";

import type { Palette } from "@/lib/theme";
import { THEME_ELEMENT_KEYS } from "@/lib/theme-elements";
import { parseStoreTheme } from "@/lib/theme-schema";

import type { InstallWithLook } from "./theme-installs";

/** A look of the theme library as `GET /themes/{id}` answers it: its palettes, typefaces, the elements' typography and its saved colours. */
export function lookForApi(install: InstallWithLook) {
  const settings = parseStoreTheme(install.look.theme).settings;
  const css = (measure?: { value: number; unit: string }) => (measure ? `${measure.value}${measure.unit}` : null);
  const palette = (p: Palette) => ({ background: p.background, surface: p.surface, text: p.text, muted: p.muted, border: p.border, accent: p.accent, accent_text: p.accentText });
  return {
    id: install.id,
    title: install.title,
    live: install.live,
    from_theme: install.presetId !== null,
    version: install.version,
    mode: settings.mode,
    light: palette(settings.light),
    dark: palette(settings.dark),
    fonts: { heading: settings.fonts.heading ?? null, body: settings.fonts.body ?? null },
    headings: { weight: settings.headings.weight, case: settings.headings.case },
    text_styles: THEME_ELEMENT_KEYS.filter((key) => key !== "row").flatMap((key) => {
      const text = settings.elements?.[key]?.typography?.text;
      return text
        ? [{ element: key, family: text.family ?? null, weight: text.weight ?? null, size: css(text.size), line_height: css(text.lineHeight), letter_spacing: css(text.letterSpacing), uppercase: text.transform === "uppercase" }]
        : [];
    }),
    saved_colours: (settings.library?.colours ?? []).map((c) => ({ name: c.name, color: c.color })),
  };
}
