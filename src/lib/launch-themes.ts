import type { PackKey } from "./content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignSnapshot, type DesignVariation } from "./design-presets";
import type { SectionStyles } from "./section-styles";
import { templateSettings, type Palette, type ThemeSettings, type ThemeTemplate } from "./theme";
import type { ThemeElements } from "./theme-elements";
import type { ThemeListing } from "./theme-store";

/**
 * Kaizena Flow's own launch themes (D246, `docs/theme-phase-2.md` step 5, `docs/theme-store.md` 0.5: three to five, made from today's
 * looks). Each is data only: a `DesignSnapshot` built on one of the built-in templates (D60) with its own palette, fonts, elements and every
 * core section style (D242), and the standard header, footer and product page, which carry the store's legal parts by themselves. They reach
 * the platform's themes through `syncLaunchThemes()` (`src/server/launch-themes.ts`), each by its `key`: a theme not there yet is made and
 * published, and one whose `version` here is newer than the one published is published again, which installs that follow updates take
 * (D245). Change a theme here by raising its `version` and saying what is new in `notes`. Every one passes `themeCheck()`
 * (`launch-themes.test.ts`).
 */

/**
 * A launch theme's preset (`docs/theme-showcase-phase-1.md` step 3): its fixed key, its name, the content pack it is shown on, and its
 * look: the theme's own settings with these changes (colours, fonts, corners, buttons), so its elements and section styles stay the theme's.
 */
export type LaunchPreset = { key: string; name: string; pack: PackKey; changes: Partial<ThemeSettings> };

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
  /**
   * Its listing in the theme store (`docs/theme-phase-3.md`); its address there is its `key`. Its pictures are the platform admin's; `pack`
   * is the content pack its own look is shown on, and its presets' come from `presets`.
   */
  listing: Omit<ThemeListing, "pictures" | "presetPacks">;
  /** Its own look (no presets in it: they are `presets`, laid over it by `launchSnapshot()`). */
  snapshot: DesignSnapshot;
  presets: LaunchPreset[];
};

/** A launch preset as a theme's version holds it: the theme's own settings with the preset's changes. */
export const launchVariation = (theme: LaunchTheme, preset: LaunchPreset): DesignVariation => ({
  key: preset.key,
  name: preset.name,
  theme: { base: theme.snapshot.theme.base, settings: { ...theme.snapshot.theme.settings, ...preset.changes } },
});

/** The listing written for a launch theme: the code's kinds, styles and packs (its own look's and each preset's). */
export const launchListing = (theme: LaunchTheme): Omit<ThemeListing, "pictures"> => ({
  ...theme.listing,
  presetPacks: Object.fromEntries(theme.presets.map((p) => [p.key, p.pack])),
});

/**
 * The newest version of each launch theme photographed by hand, in `public/demo/themes/` (the theme showcase plan's quick fixes, D255).
 * Since phase 2 (`docs/theme-showcase-phase-2.md`) every publish photographs a theme's looks itself, so these are only the card's fallback
 * until those are made (and where they cannot be, as in development and the browser tests): raising a version needs no new one.
 */
export const LAUNCH_SHOTS: Readonly<Record<string, number>> = { calm: 2, hearth: 2, signal: 2, fjord: 2 };

/**
 * The theme's card picture by hand: its public preview on the demo store, photographed at a computer's width (a 4:3 crop of the top, 800 by
 * 600 WebP), at the newest version photographed and not past the theme's own.
 */
export const launchShot = (theme: Pick<LaunchTheme, "key" | "version">): string =>
  `/demo/themes/${theme.key}-v${Math.min(theme.version, LAUNCH_SHOTS[theme.key] ?? theme.version)}.webp`;

/** The card picture of the launch theme a platform theme was made from (`design_presets.launch_key`), or null. */
export function launchShotFor(key: string | null): string | null {
  const theme = key ? LAUNCH_THEMES.find((t) => t.key === key) : undefined;
  return theme ? launchShot(theme) : null;
}

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
    version: 2,
    title: "Calm",
    summary: "Quiet and neutral, with room to breathe.",
    description:
      "Black and white with soft greys, system fonts and pill buttons. Generous space between sections lets products and pictures speak. Follows the visitor's light or dark mode.",
    notes: "Three presets: Sand, warm beige with Lora headings; Ink, always dark with a blue accent; Sage, soft green-grey.",
    listing: {
      kinds: [],
      styles: ["minimal"],
      pack: "fashion",
      highlights: {
        devices: { title: "Calm on every screen", text: "The same quiet layout on a computer and a phone, with the menu folded away on small screens." },
        collage: { title: "Room to breathe", text: "Generous spacing and clear type let products and stories take the lead." },
        closeup: { title: "Product pages kept simple", text: "Price, choices and the button to add to the cart sit together, with the details below." },
      },
    },
    snapshot: theme(
      "minimal",
      { corners: { cards: "medium", fields: "small" } },
      { h1: { typography: { text: { size: rem(2.75) } } }, h2: { typography: { text: { size: rem(2) } } } },
      coreStyles({ heroSize: 3.75, band: "#171717", bandText: "#fafafa", space: 56 }),
    ),
    presets: [
      {
        key: "sand",
        name: "Sand",
        pack: "beauty",
        changes: {
          light: { background: "#faf7f2", surface: "#f0e9df", text: "#2a2420", muted: "#6b6058", border: "#e6ddd1", accent: "#8a5a44", accentText: "#ffffff" },
          dark: { background: "#1a1613", surface: "#26201b", text: "#f2ebe3", muted: "#b8ab9e", border: "#3a322b", accent: "#d9a88c", accentText: "#1a1613" },
          fonts: { heading: "Lora" },
          corners: { cards: "large", fields: "small" },
        },
      },
      {
        key: "ink",
        name: "Ink",
        pack: "electronics",
        changes: {
          mode: "dark",
          dark: { background: "#0d0f12", surface: "#171a1f", text: "#e8eaed", muted: "#9aa1ab", border: "#2a2f36", accent: "#4f8cff", accentText: "#0d0f12" },
          fonts: { heading: "Inter", body: "Inter" },
          buttons: { style: "filled", corners: "rounded" },
          corners: { cards: "small", fields: "small" },
        },
      },
      {
        key: "sage",
        name: "Sage",
        pack: "home",
        changes: {
          light: { background: "#f6f7f4", surface: "#e9ece5", text: "#1f2620", muted: "#56605a", border: "#d9ded4", accent: "#3f5e4a", accentText: "#ffffff" },
          dark: { background: "#121613", surface: "#1c221d", text: "#e7ece6", muted: "#a6b0a8", border: "#2c342d", accent: "#9cc4a8", accentText: "#121613" },
          buttons: { style: "filled", corners: "rounded" },
        },
      },
    ],
  },
  {
    key: "hearth",
    version: 2,
    title: "Hearth",
    summary: "Warm and classic, for crafts, food and home.",
    description:
      "Cream paper and terracotta, Playfair Display headings over Lora, softly rounded bordered cards and a centred logo. Quotes are set large in the heading font.",
    notes: "Two presets: Olive, warm white and olive green; Blush, rose and plum.",
    listing: {
      kinds: ["food", "home", "crafts"],
      styles: ["warm", "classic"],
      pack: "food",
      highlights: {
        devices: { title: "Warm on any screen", text: "Hearth's warm colours and friendly type carry from a computer to a phone." },
        collage: { title: "Made for stories", text: "Sections for your story, your range and your place, in Hearth's warm palette." },
        closeup: { title: "Products with character", text: "Large pictures and clear prices give each product room on its page." },
      },
    },
    snapshot: theme(
      "warm",
      {},
      { h1: { typography: { text: { size: rem(2.75) } } }, h2: { typography: { text: { size: rem(2) } } }, p: { typography: { text: { lineHeight: { value: 1.7, unit: "" } } } } },
      coreStyles({ heroSize: 3.5, band: "#3a2a1f", bandText: "#fdf6ec", space: 48, quoteFamily: "Playfair Display" }),
    ),
    presets: [
      {
        key: "olive",
        name: "Olive",
        pack: "home",
        changes: {
          light: { background: "#f7f5ee", surface: "#ece8da", text: "#26261c", muted: "#5f5e4c", border: "#ddd8c4", accent: "#5c6b2e", accentText: "#fffdf5" },
          dark: { background: "#181812", surface: "#23231a", text: "#efedde", muted: "#b9b59c", border: "#3a3a2c", accent: "#b7c47a", accentText: "#181812" },
          productCards: { image: "square", style: "bordered", align: "center" },
        },
      },
      {
        key: "blush",
        name: "Blush",
        pack: "beauty",
        changes: {
          light: { background: "#fbf5f3", surface: "#f3e6e1", text: "#2e1f1c", muted: "#6e5650", border: "#e7d4cd", accent: "#9c3d54", accentText: "#ffffff" },
          dark: { background: "#1c1416", surface: "#2a1e21", text: "#f5e9ea", muted: "#c4a9ae", border: "#45333a", accent: "#e8a0b0", accentText: "#1c1416" },
          buttons: { style: "filled", corners: "pill" },
          corners: { cards: "medium", fields: "small" },
        },
      },
    ],
  },
  {
    key: "signal",
    version: 2,
    title: "Signal",
    summary: "Bold and modern, high contrast and square.",
    description:
      "A black header, square corners, a bright orange accent, Archivo headings in spaced capitals and edge-to-edge product pictures. Sections sit close together.",
    notes: "Two presets: Volt, always dark with an electric yellow-green; Cobalt, a strong blue with headings as written.",
    listing: {
      kinds: ["fashion", "digital"],
      styles: ["bold"],
      pack: "fashion",
      highlights: {
        devices: { title: "Bold on every screen", text: "Strong type and high contrast hold together on a computer and a phone." },
        collage: { title: "Sections that stand out", text: "Strong headings and clear blocks mark each part of the page." },
        closeup: { title: "A clear way to buy", text: "A large title, the price and the button to add to the cart, side by side." },
      },
    },
    snapshot: theme(
      "bold",
      {},
      { h1: { typography: { text: { size: rem(3), letterSpacing: { value: 0.02, unit: "em" } } } }, h2: { typography: { text: { size: rem(2.25) } } } },
      coreStyles({ heroSize: 4.5, band: "#0a0a0a", bandText: "#ffffff", space: 40 }),
    ),
    presets: [
      {
        key: "volt",
        name: "Volt",
        pack: "electronics",
        changes: {
          mode: "dark",
          dark: { background: "#0a0a0a", surface: "#161616", text: "#f5f5f5", muted: "#a3a3a3", border: "#f5f5f5", accent: "#d4ff3a", accentText: "#0a0a0a" },
        },
      },
      {
        key: "cobalt",
        name: "Cobalt",
        pack: "services",
        changes: {
          light: { background: "#ffffff", surface: "#eef1ff", text: "#0a0a0a", muted: "#4a4f63", border: "#0a0a0a", accent: "#1f3fff", accentText: "#ffffff" },
          dark: { background: "#0a0a12", surface: "#161a2c", text: "#f5f6ff", muted: "#a3a8c2", border: "#f5f6ff", accent: "#7d93ff", accentText: "#0a0a12" },
          headings: { weight: "bold", case: "normal" },
          buttons: { style: "filled", corners: "rounded" },
        },
      },
    ],
  },
  {
    key: "fjord",
    version: 2,
    title: "Fjord",
    summary: "Cool and clear, blue-grey and fresh.",
    description:
      "A blue-grey palette with a deep sea-blue accent, Inter throughout, rounded buttons and raised product cards. Light by day and dark by night, as the visitor's device says.",
    notes: "Two presets: Mist, pale lilac and violet with Playfair Display headings; Pine, a deep forest green.",
    listing: {
      kinds: ["home", "beauty", "services"],
      styles: ["minimal", "natural"],
      pack: "home",
      highlights: {
        devices: { title: "Clear on any screen", text: "Fjord's cool colours and open layout read well on a computer and a phone." },
        collage: { title: "Calm, open sections", text: "Light backgrounds and soft lines let the pictures speak first." },
        closeup: { title: "Details at a glance", text: "Pictures, price and choices laid out plainly on every product page." },
      },
    },
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
    presets: [
      {
        key: "mist",
        name: "Mist",
        pack: "beauty",
        changes: {
          light: { background: "#f8f7fb", surface: "#ece9f3", text: "#1f1b2e", muted: "#575270", border: "#dcd7e8", accent: "#5b4b9a", accentText: "#ffffff" },
          dark: { background: "#14121c", surface: "#1f1c2a", text: "#ece9f5", muted: "#aca6c4", border: "#312d42", accent: "#b5a8f0", accentText: "#14121c" },
          fonts: { heading: "Playfair Display", body: "Inter" },
        },
      },
      {
        key: "pine",
        name: "Pine",
        pack: "services",
        changes: {
          light: { background: "#f5f8f6", surface: "#e4ece7", text: "#10221a", muted: "#46594f", border: "#cfddd5", accent: "#1d5c43", accentText: "#ffffff" },
          dark: { background: "#0d1612", surface: "#16221c", text: "#e4efe9", muted: "#9db5a9", border: "#25362d", accent: "#7fd1ab", accentText: "#0d1612" },
          productCards: { image: "square", style: "raised", align: "left" },
        },
      },
    ],
  },
];
