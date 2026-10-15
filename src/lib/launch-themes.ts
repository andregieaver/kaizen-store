import { DESIGN_SNAPSHOT_VERSION, type DesignSnapshot } from "./design-presets";
import type { SectionStyles } from "./section-styles";
import { templateSettings, type Palette, type ThemeSettings, type ThemeTemplate } from "./theme";
import type { ThemeElements } from "./theme-elements";

/**
 * Kaizena Flow's own launch themes (D246, `docs/theme-phase-2.md` step 5, `docs/theme-store.md` 0.5: three to five, made from today's
 * looks). Each is data only: a `DesignSnapshot` built on one of the built-in templates (D60) with its own palette, fonts, elements and every
 * core section style (D242), and the standard header, footer and product page, which carry the store's legal parts by themselves. They reach
 * the platform's themes through `syncLaunchThemes()` (`src/server/launch-themes.ts`), each by its `key`: a theme not there yet is made and
 * published, and one whose `version` here is newer than the one published is published again, which installs that follow updates take
 * (D245). Change a theme here by raising its `version` and saying what is new in `notes`. Every one passes `themeCheck()`
 * (`launch-themes.test.ts`).
 */

export type LaunchTheme = {
  /** Stable for ever: how the platform's theme is found again (`design_presets.launch_key`). */
  key: string;
  /** Raised with every change here; a newer one is published as a new version. */
  version: number;
  title: string;
  summary: string;
  description: string;
  /** *What's new* for the version (D245), null for the first. */
  notes: string | null;
  snapshot: DesignSnapshot;
};

const pad = (y: number, x = 20) => ({ padding: { top: y, right: x, bottom: y, left: x } });
const rem = (value: number) => ({ value, unit: "rem" as const });

/**
 * The core section styles, so rows naming them look as intended in every Kaizena theme: room for the hero, a quiet tint for muted that works
 * on light and dark pages alike (a see-through grey over the page), a fixed dark band for contrast with its own light text, and larger
 * italic text for quotes.
 */
function coreStyles(look: { heroSize: number; band: string; bandText: string; space: number; quoteFamily?: string }): SectionStyles {
  return {
    plain: { row: { style: pad(look.space) } },
    hero: {
      row: { style: pad(look.space * 2) },
      h1: { typography: { text: { size: rem(look.heroSize), lineHeight: { value: 1.1, unit: "" } } } },
      p: { typography: { text: { size: rem(1.25) } } },
    },
    feature: {
      row: { style: pad(Math.round(look.space * 1.25)) },
      h3: { typography: { text: { size: rem(1.375) } } },
    },
    muted: { row: { style: pad(look.space), background: { type: "color", color: "#808080", opacity: 10 } } },
    contrast: {
      row: { style: pad(Math.round(look.space * 1.25)), background: { type: "color", color: look.band }, typography: { text: { color: look.bandText } } },
    },
    quote: {
      row: { style: pad(look.space) },
      p: { typography: { text: { size: rem(1.5), style: "italic", lineHeight: { value: 1.4, unit: "" }, ...(look.quoteFamily && { family: look.quoteFamily }) } } },
    },
  };
}

/**
 * The core section styles a theme made from a store, or from scratch, starts with where it has none (D246): neutral, legible in light and
 * dark alike, so it passes the checks until the admin makes them its own in the Theme tab.
 */
export const NEUTRAL_CORE_STYLES: SectionStyles = coreStyles({ heroSize: 3.5, band: "#1a1a1a", bandText: "#fafafa", space: 48 });

/** A theme's settings with every missing core section style filled from `NEUTRAL_CORE_STYLES`; the ones it has are kept as they are. */
export function withCoreStyles(settings: ThemeSettings): ThemeSettings {
  const missing = Object.entries(NEUTRAL_CORE_STYLES).filter(([name]) => !settings.sectionStyles?.[name]);
  if (missing.length === 0) return settings;
  return { ...settings, sectionStyles: { ...(settings.sectionStyles ?? {}), ...Object.fromEntries(missing) } };
}

function theme(base: ThemeTemplate, changes: Partial<ThemeSettings> & { light?: Palette; dark?: Palette }, elements: ThemeElements, sectionStyles: SectionStyles): DesignSnapshot {
  const settings: ThemeSettings = { ...templateSettings(base), ...changes, elements, sectionStyles };
  return { v: DESIGN_SNAPSHOT_VERSION, theme: { base, settings }, header: null, footer: null, productLayout: null, css: "" };
}

export const LAUNCH_THEMES: readonly LaunchTheme[] = [
  {
    key: "calm",
    version: 1,
    title: "Calm",
    summary: "Quiet and neutral, with room to breathe.",
    description:
      "Black and white with soft greys, system fonts and pill buttons. Generous space between sections lets products and pictures speak. Follows the visitor's light or dark mode.",
    notes: null,
    snapshot: theme(
      "minimal",
      { corners: { cards: "medium", fields: "small" } },
      { h1: { typography: { text: { size: rem(2.75) } } }, h2: { typography: { text: { size: rem(2) } } } },
      coreStyles({ heroSize: 3.75, band: "#171717", bandText: "#fafafa", space: 56 }),
    ),
  },
  {
    key: "hearth",
    version: 1,
    title: "Hearth",
    summary: "Warm and classic, for crafts, food and home.",
    description:
      "Cream paper and terracotta, Playfair Display headings over Lora, softly rounded bordered cards and a centred logo. Quotes are set large in the heading font.",
    notes: null,
    snapshot: theme(
      "warm",
      {},
      { h1: { typography: { text: { size: rem(2.75) } } }, h2: { typography: { text: { size: rem(2) } } }, p: { typography: { text: { lineHeight: { value: 1.7, unit: "" } } } } },
      coreStyles({ heroSize: 3.5, band: "#3a2a1f", bandText: "#fdf6ec", space: 48, quoteFamily: "Playfair Display" }),
    ),
  },
  {
    key: "signal",
    version: 1,
    title: "Signal",
    summary: "Bold and modern, high contrast and square.",
    description:
      "A black header, square corners, a bright orange accent, Archivo headings in spaced capitals and edge-to-edge product pictures. Sections sit close together.",
    notes: null,
    snapshot: theme(
      "bold",
      {},
      { h1: { typography: { text: { size: rem(3), letterSpacing: { value: 0.02, unit: "em" } } } }, h2: { typography: { text: { size: rem(2.25) } } } },
      coreStyles({ heroSize: 4.5, band: "#0a0a0a", bandText: "#ffffff", space: 40 }),
    ),
  },
  {
    key: "fjord",
    version: 1,
    title: "Fjord",
    summary: "Cool and clear, blue-grey and fresh.",
    description:
      "A blue-grey palette with a deep sea-blue accent, Inter throughout, rounded buttons and raised product cards. Light by day and dark by night, as the visitor's device says.",
    notes: null,
    snapshot: theme(
      "minimal",
      {
        light: { background: "#f7fafc", surface: "#e8eff5", text: "#0f1f2e", muted: "#46596b", border: "#cfdbe6", accent: "#0f5c8c", accentText: "#ffffff" },
        dark: { background: "#0b1620", surface: "#15222e", text: "#e6eef5", muted: "#9db0c2", border: "#263544", accent: "#7cc4f0", accentText: "#0b1620" },
        fonts: { heading: "Inter", body: "Inter" },
        headings: { weight: "semibold", case: "normal" },
        buttons: { style: "filled", corners: "rounded" },
        productCards: { image: "landscape", style: "raised", align: "left" },
      },
      { h1: { typography: { text: { size: rem(2.75), letterSpacing: { value: -0.01, unit: "em" } } } }, h2: { typography: { text: { size: rem(2) } } } },
      coreStyles({ heroSize: 3.5, band: "#0f2a3d", bandText: "#f1f7fb", space: 48 }),
    ),
  },
];
