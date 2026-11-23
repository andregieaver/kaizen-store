import { fillWords } from "./admin-fill";
import { baseScheme } from "./color-mode";
import { hoverTimingVars, type ThemeHover } from "./hover-timing";
import { DEFAULT_BREAKPOINTS, type Breakpoints } from "./breakpoints";
import type { SiteFonts } from "./fonts-schema";
import type { ColourLibrary } from "./colour-library";
import type { ThemeElements } from "./theme-elements";
import type { SectionStyles } from "./section-styles";

/**
 * Store design themes (D60): every style setting of a storefront, the
 * built-in templates they start from, and the CSS that applies them. Shared
 * by the storefront, the admin's Design page and its preview.
 *
 * A theme is only settings: colours as CSS variables (a light and a dark
 * set), fonts (self-hosted, D59) and a few choices drawn by globals.css
 * through data attributes on `<html>`. Nothing in it is ever raw CSS.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** One colour set. `text` is the main text, `muted` secondary text, `accent` buttons and highlights. */
export const PALETTE_KEYS = ["background", "surface", "text", "muted", "border", "accent", "accentText"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

export const PALETTE_LABELS: Record<PaletteKey, { name: string; hint: string }> = {
  background: { name: "Background", hint: "Behind everything." },
  surface: { name: "Surface", hint: "Panels, the footer and picture placeholders." },
  text: { name: "Text", hint: "Headings and body text." },
  muted: { name: "Secondary text", hint: "Notes, dates and prices' labels." },
  border: { name: "Lines", hint: "Borders and dividers." },
  accent: { name: "Accent", hint: "Buttons and highlights." },
  accentText: { name: "Text on accent", hint: "Text on buttons." },
};

export const COLOR_MODES = { auto: "Follow the visitor's device", light: "Always light", dark: "Always dark" } as const;
export type ColorMode = keyof typeof COLOR_MODES;

export const HEADING_WEIGHTS = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;
export type HeadingWeight = keyof typeof HEADING_WEIGHTS;
export const HEADING_CASES = { normal: "As written", upper: "Capitals, spaced" } as const;
export type HeadingCase = keyof typeof HEADING_CASES;

export const BUTTON_CORNERS = { square: "Square", rounded: "Rounded", pill: "Pill" } as const;
export type ButtonCorners = keyof typeof BUTTON_CORNERS;
export const CARD_CORNERS = { none: "None", small: "Small", medium: "Medium", large: "Large" } as const;
export type CardCorners = keyof typeof CARD_CORNERS;
export const FIELD_CORNERS = { none: "None", small: "Small", large: "Large" } as const;
export type FieldCorners = keyof typeof FIELD_CORNERS;
export const BUTTON_STYLES = { filled: "Filled", outline: "Outline" } as const;
export type ButtonStyle = keyof typeof BUTTON_STYLES;

export const CONTENT_WIDTHS = { narrow: "Narrow", normal: "Normal", wide: "Wide" } as const;
export type ContentWidth = keyof typeof CONTENT_WIDTHS;
export const HEADER_ALIGNS = { left: "Logo on the left", center: "Logo in the middle" } as const;
export type HeaderAlign = keyof typeof HEADER_ALIGNS;
export const HEADER_BACKGROUNDS = {
  page: "Like the page",
  surface: "Surface colour",
  accent: "Accent colour",
  inverse: "Inverted (text colour)",
} as const;
export type HeaderBackground = keyof typeof HEADER_BACKGROUNDS;

export const CARD_IMAGES = { square: "Square", portrait: "Portrait", landscape: "Landscape" } as const;
export type CardImage = keyof typeof CARD_IMAGES;
export const CARD_STYLES = { plain: "Plain", bordered: "Bordered", raised: "Raised" } as const;
export type CardStyle = keyof typeof CARD_STYLES;
export const CARD_ALIGNS = { left: "Left", center: "Centred" } as const;
export type CardAlign = keyof typeof CARD_ALIGNS;

/** What the checkout's payment form sits on (D337): the page's background, or a panel in the surface colour. */
export const CHECKOUT_BACKGROUNDS = { page: "Like the page", surface: "A panel in the surface colour" } as const;
export type CheckoutBackground = keyof typeof CHECKOUT_BACKGROUNDS;
/** How Stripe's payment fields are drawn at checkout (D337): a box, a filled box, or a line under each field. */
export const CHECKOUT_FIELDS = { outlined: "Outlined", filled: "Filled", underlined: "A line under" } as const;
export type CheckoutFields = keyof typeof CHECKOUT_FIELDS;

/**
 * The checkout's look (D337, `src/lib/checkout-appearance.ts`). Stripe's payment form always takes the theme's colours, body font and
 * corners; these change the checkout only, and what is left out follows the theme: no `button`, the pay button is the accent; no
 * `corners`, the theme's button corners.
 */
export type CheckoutLook = {
  /** The store's mark (its logo, from Header and footer) above the payment form; the header shows it too, unless a header of the store's own leaves it out. */
  mark?: boolean;
  background?: CheckoutBackground;
  /** The pay button's colour (and Stripe's main colour) in the light and the dark set, over the accent. */
  button?: { light: string; dark: string };
  /** The pay button's corners (and Stripe's buttons'), over the theme's button corners. */
  corners?: ButtonCorners;
  fields?: CheckoutFields;
};

/**
 * The cookie banner and popup's look (D883, `src/lib/consent-look.ts`): drawn over the whole page, outside any row, they took the site's
 * colour set even where the page around them is dark, and had no settings. `scheme` says which set they take (the site's, or always the
 * light or the dark one); what is left out follows the theme: no `colours`, the set's own; no `corners`, the cards'; no `buttonCorners`, the
 * buttons'; no `heading`, the headings' font; no `shadow`, a strong one.
 */
export const CONSENT_SCHEMES = { site: "Like the site", light: "Light", dark: "Dark" } as const;
export type ConsentScheme = keyof typeof CONSENT_SCHEMES;
export const CONSENT_COLOUR_KEYS = ["background", "text", "muted", "border", "button", "buttonText", "secondary", "secondaryText"] as const;
export type ConsentColourKey = (typeof CONSENT_COLOUR_KEYS)[number];
export type ConsentColours = Record<ConsentColourKey, string>;
export const CONSENT_HEADINGS = { heading: "The headings' font", body: "The body text's font" } as const;
export type ConsentHeading = keyof typeof CONSENT_HEADINGS;
export const CONSENT_SHADOWS = { none: "None", soft: "Soft", strong: "Strong" } as const;
export type ConsentShadow = keyof typeof CONSENT_SHADOWS;

export type ConsentLook = {
  scheme?: ConsentScheme;
  /** Colours of its own in the light and the dark set, over the set's. */
  colours?: { light: ConsentColours; dark: ConsentColours };
  /** The box's corners, over the cards' corners. */
  corners?: CardCorners;
  /** The buttons' corners, over the theme's button corners. */
  buttonCorners?: ButtonCorners;
  heading?: ConsentHeading;
  shadow?: ConsentShadow;
};

export type ThemeSettings = {
  mode: ColorMode;
  /** Visitors may choose light or dark for themselves (D99), over the store's mode; the header shows a switch. */
  visitorSwitch: boolean;
  light: Palette;
  dark: Palette;
  fonts: SiteFonts;
  headings: { weight: HeadingWeight; case: HeadingCase };
  buttons: { style: ButtonStyle; corners: ButtonCorners };
  corners: { cards: CardCorners; fields: FieldCorners };
  /** `maxWidth`: the content's width in pixels, over the choice `width` (the page builder's Theme tab). */
  layout: { width: ContentWidth; maxWidth?: number; headerAlign: HeaderAlign; headerBackground: HeaderBackground };
  productCards: { image: CardImage; style: CardStyle; align: CardAlign };
  /**
   * Where the screen sizes start (D179, `src/lib/breakpoints.ts`): the part rules of every page, header, footer and
   * layout are written for them. The defaults keep pages saved before as they were.
   */
  breakpoints?: Breakpoints;
  /**
   * What the page builder's Theme tab says for every row, heading, paragraph, list and button of the store's pages
   * (D182, `src/lib/theme-elements.ts`): typography, spacing, frame and, for rows, colour and content width.
   */
  elements?: ThemeElements;
  /** Named sets of elements for the rows that name them (D242, `src/lib/section-styles.ts`), laid over `elements` for those rows. */
  sectionStyles?: SectionStyles;
  /** The store's saved colours and gradients (D183), offered in the page builder's colour fields and gradient editors; copied into a part when used. */
  library?: ColourLibrary;
  /** How hover changes play out on the site (D206): their time, easing and the buttons' default answer. */
  hover?: ThemeHover;
  /** The checkout's look (D337): Design settings' *Checkout look*; what it leaves out follows the theme. */
  checkout?: CheckoutLook;
  /** The cookie banner and popup's look (D883): Design settings' *Cookie popup*; what it leaves out follows the theme. */
  consent?: ConsentLook;
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The built-in themes. Minimal is the demo store's own look, collected
 * from what the storefront drew before themes; Warm classic is its first
 * variation, and Bold modern its second (D60).
 */
export const THEME_TEMPLATES = {
  minimal: {
    name: "Minimal",
    description: "Quiet and neutral: system fonts, black and white, pill buttons. Follows the visitor's light or dark mode.",
    settings: {
      mode: "auto",
      visitorSwitch: false,
      light: {
        background: "#ffffff",
        surface: "#f5f5f4",
        text: "#171717",
        muted: "#525252",
        border: "#e5e5e5",
        accent: "#171717",
        accentText: "#ffffff",
      },
      dark: {
        background: "#0a0a0a",
        surface: "#1c1c1c",
        text: "#ededed",
        muted: "#a3a3a3",
        border: "#2e2e2e",
        accent: "#ededed",
        accentText: "#0a0a0a",
      },
      fonts: {},
      headings: { weight: "semibold", case: "normal" },
      buttons: { style: "filled", corners: "pill" },
      corners: { cards: "medium", fields: "small" },
      layout: { width: "normal", headerAlign: "left", headerBackground: "page" },
      productCards: { image: "square", style: "plain", align: "left" },
      breakpoints: DEFAULT_BREAKPOINTS,
      checkout: { mark: false, background: "page", fields: "outlined" },
    },
  },
  warm: {
    name: "Warm classic",
    description: "Cream paper and terracotta, Playfair Display headings over Lora, softly rounded bordered cards and a centred logo.",
    settings: {
      mode: "light",
      visitorSwitch: false,
      light: {
        background: "#faf6ef",
        surface: "#f1e8da",
        text: "#2b2118",
        muted: "#6b5a4a",
        border: "#e2d5c1",
        accent: "#a84a26",
        accentText: "#fffaf3",
      },
      dark: {
        background: "#1c1612",
        surface: "#2a211b",
        text: "#f3eadf",
        muted: "#bfae98",
        border: "#43362c",
        accent: "#e58a5f",
        accentText: "#1c1612",
      },
      fonts: { heading: "Playfair Display", body: "Lora" },
      headings: { weight: "semibold", case: "normal" },
      buttons: { style: "filled", corners: "rounded" },
      corners: { cards: "small", fields: "small" },
      layout: { width: "normal", headerAlign: "center", headerBackground: "page" },
      productCards: { image: "portrait", style: "bordered", align: "center" },
      breakpoints: DEFAULT_BREAKPOINTS,
      checkout: { mark: false, background: "page", fields: "outlined" },
    },
  },
  bold: {
    name: "Bold modern",
    description: "High contrast: a black header, square corners, a bright orange accent, Archivo headings in spaced capitals and edge-to-edge product pictures.",
    settings: {
      mode: "auto",
      visitorSwitch: false,
      light: {
        background: "#ffffff",
        surface: "#f0f0f0",
        text: "#0a0a0a",
        muted: "#525252",
        border: "#0a0a0a",
        accent: "#ff4f00",
        accentText: "#0a0a0a",
      },
      dark: {
        background: "#0a0a0a",
        surface: "#1a1a1a",
        text: "#f5f5f5",
        muted: "#a3a3a3",
        border: "#f5f5f5",
        accent: "#ff5c1a",
        accentText: "#0a0a0a",
      },
      fonts: { heading: "Archivo", body: "Inter" },
      headings: { weight: "bold", case: "upper" },
      buttons: { style: "filled", corners: "square" },
      corners: { cards: "none", fields: "none" },
      layout: { width: "wide", headerAlign: "left", headerBackground: "inverse" },
      productCards: { image: "portrait", style: "plain", align: "left" },
      breakpoints: DEFAULT_BREAKPOINTS,
      checkout: { mark: false, background: "page", fields: "outlined" },
    },
  },
} as const satisfies Record<string, { name: string; description: string; settings: ThemeSettings }>;

export type ThemeTemplate = keyof typeof THEME_TEMPLATES;
export const THEME_TEMPLATE_KEYS = Object.keys(THEME_TEMPLATES) as [ThemeTemplate, ...ThemeTemplate[]];

/** A fresh copy of a template's settings, to edit. */
export const templateSettings = (template: ThemeTemplate): ThemeSettings => structuredClone(THEME_TEMPLATES[template].settings) as ThemeSettings;

// ---------------------------------------------------------------------------
// A store's theme
// ---------------------------------------------------------------------------

/**
 * What a store shows (`stores.theme`): the template it started from, the
 * saved theme it was loaded from if any (D60), and its settings.
 */
export type StoreTheme = { base: ThemeTemplate; savedId: string | null; settings: ThemeSettings };

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export const BUTTON_RADIUS: Record<ButtonCorners, string> = { square: "0", rounded: "0.375rem", pill: "9999px" };
const CARD_RADIUS: Record<CardCorners, string> = { none: "0", small: "0.25rem", medium: "0.5rem", large: "1rem" };
export const FIELD_RADIUS: Record<FieldCorners, string> = { none: "0", small: "0.375rem", large: "0.75rem" };
const WIDTH: Record<ContentWidth, string> = { narrow: "56rem", normal: "64rem", wide: "80rem" };
const ASPECT: Record<CardImage, string> = { square: "1 / 1", portrait: "3 / 4", landscape: "4 / 3" };

const paletteVars = (p: Palette, scheme: "light" | "dark") =>
  [
    `color-scheme: ${scheme}`,
    `--background: ${p.background}`,
    `--surface: ${p.surface}`,
    `--foreground: ${p.text}`,
    `--muted: ${p.muted}`,
    `--border: ${p.border}`,
    `--accent: ${p.accent}`,
    `--accent-foreground: ${p.accentText}`,
  ].join("; ");

/**
 * The checkout's pay button in a colour set (D337): the owner's own colour with the more readable of the set's background and text colours
 * on it, else the accent and its text.
 */
export function checkoutButton(settings: ThemeSettings, scheme: "light" | "dark"): { fill: string; text: string } {
  const set = settings[scheme];
  const own = settings.checkout?.button?.[scheme];
  if (!own) return { fill: set.accent, text: set.accentText };
  const text = contrastRatio(own, set.background) >= contrastRatio(own, set.text) ? set.background : set.text;
  return { fill: own, text };
}

/** The checkout's own variables in a colour set (D337), which `.checkout-look` (globals.css) puts in place of the accent's. */
const checkoutVars = (settings: ThemeSettings, scheme: "light" | "dark") => {
  const button = checkoutButton(settings, scheme);
  return [`--checkout-accent: ${button.fill}`, `--checkout-accent-foreground: ${button.text}`].join("; ");
};

/**
 * The cookie banner and popup's colours (D883) where the page shows the `scheme` set: the set the popup takes (the page's, unless its look
 * names one), its own colours in that set where it has them, else the set's (the main button the accent, the others the background).
 */
export function consentColours(settings: ThemeSettings, scheme: "light" | "dark"): { set: "light" | "dark"; colours: ConsentColours } {
  const look = settings.consent;
  const set = look?.scheme === "light" || look?.scheme === "dark" ? look.scheme : scheme;
  const own = look?.colours?.[set];
  if (own) return { set, colours: own };
  const p = settings[set];
  return {
    set,
    colours: {
      background: p.background,
      text: p.text,
      muted: p.muted,
      border: p.border,
      button: p.accent,
      buttonText: p.accentText,
      secondary: p.background,
      secondaryText: p.text,
    },
  };
}

/** The cookie popup's own variables in a colour set (D883), which `.consent-look` (globals.css) puts in place of the theme's. */
const consentVars = (settings: ThemeSettings, scheme: "light" | "dark") => {
  const { set, colours: c } = consentColours(settings, scheme);
  return [
    `--consent-scheme: ${set}`,
    `--consent-background: ${c.background}`,
    `--consent-foreground: ${c.text}`,
    `--consent-muted: ${c.muted}`,
    `--consent-border: ${c.border}`,
    `--consent-accent: ${c.button}`,
    `--consent-accent-foreground: ${c.buttonText}`,
    `--consent-secondary: ${c.secondary}`,
    `--consent-secondary-foreground: ${c.secondaryText}`,
  ].join("; ");
};

/** The cookie popup's shadows (D883). */
export const CONSENT_SHADOW_CSS: Record<ConsentShadow, string> = {
  none: "none",
  soft: "0 4px 16px -4px rgb(0 0 0 / 0.16)",
  strong: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
};

/**
 * Where a store's or Kaizena Flow's theme is drawn on its pages: on `<html>`. It must out-weigh globals.css's own colours for a mode
 * (`:root[data-color-mode="dark"]`, two attribute or pseudo-class parts), or a theme that is always dark shows the default greys in place of its
 * own background, text and borders; `html:root[…]` is one part more.
 */
export const STORE_THEME_SELECTOR = "html:root[data-store-theme]";

/**
 * The CSS for a theme under `selector`: its colours as the variables the
 * storefront's classes read, and its sizes. The store's mode sets the
 * colours (light, dark, or each by the visitor's device); a visitor's own
 * choice (D99, `data-color-mode` on the element or around it, where it has
 * no mode of its own) takes the other set. `preview` shows one set only,
 * for the admin's preview. Every value comes from the validated settings,
 * never from free text.
 */
export function themeCss(settings: ThemeSettings, selector: string, preview?: "light" | "dark"): string {
  const sizes = [
    `--button-radius: ${BUTTON_RADIUS[settings.buttons.corners]}`,
    `--radius-lg: ${CARD_RADIUS[settings.corners.cards]}`,
    `--radius-md: ${FIELD_RADIUS[settings.corners.fields]}`,
    `--content-width: ${settings.layout.maxWidth ? `${settings.layout.maxWidth}px` : WIDTH[settings.layout.width]}`,
    `--card-aspect: ${ASPECT[settings.productCards.image]}`,
    `--heading-weight: ${HEADING_WEIGHTS[settings.headings.weight]}`,
    // The checkout's pay button (D337): its own corners, else the theme's buttons'.
    `--checkout-button-radius: ${BUTTON_RADIUS[settings.checkout?.corners ?? settings.buttons.corners]}`,
    // The cookie popup (D883): its own corners and shadow, else the cards' and the buttons' corners and a strong shadow.
    `--consent-radius: ${CARD_RADIUS[settings.consent?.corners ?? settings.corners.cards]}`,
    `--consent-button-radius: ${BUTTON_RADIUS[settings.consent?.buttonCorners ?? settings.buttons.corners]}`,
    `--consent-shadow: ${CONSENT_SHADOW_CSS[settings.consent?.shadow ?? "strong"]}`,
    // The site's hover timing (D206): only what the owner set, so effects keep their own times otherwise.
    ...Object.entries(hoverTimingVars(settings.hover)).map(([name, value]) => `${name}: ${value}`),
  ].join("; ");
  const colors = (scheme: "light" | "dark") =>
    `${paletteVars(settings[scheme], scheme)}; ${checkoutVars(settings, scheme)}; ${consentVars(settings, scheme)}`;
  // A row or column on a light or dark background of its own (D390, `src/lib/background-surface.ts`) holds the colour set made for that
  // background, whatever the page's, so text in the theme's colours stays readable on it in both.
  const surfaces = (["light", "dark"] as const).map((scheme) => `\n${selector} .kz-on-${scheme} { ${colors(scheme)}; color: var(--foreground); }`).join("");
  if (preview) return `${selector} { ${colors(preview)}; ${sizes}; }${surfaces}`;
  const base = baseScheme(settings);
  const other = base === "dark" ? "light" : "dark";
  let css = `${selector} { ${colors(base)}; ${sizes}; }`;
  if (settings.mode === "auto") {
    css += `\n@media (prefers-color-scheme: dark) { ${selector}:not([data-color-mode="light"], [data-color-mode="light"] *) { ${colors("dark")}; } }`;
  }
  css += `\n${selector}[data-color-mode="${other}"], :where([data-color-mode="${other}"]) ${selector}:not([data-color-mode]) { ${colors(other)}; }`;
  return css + surfaces;
}

/**
 * The data attributes globals.css draws a theme's choices from, on `<html>`
 * (or the preview's box); a store always light or dark says so, so that
 * everything drawn by the device's mode (`dark:`) follows it too (D99).
 */
export function themeAttributes(settings: ThemeSettings): Record<string, string> {
  return {
    "data-store-theme": "",
    "data-button-style": settings.buttons.style,
    "data-heading-case": settings.headings.case,
    "data-card-style": settings.productCards.style,
    "data-card-align": settings.productCards.align,
    ...(settings.hover?.button && { "data-button-hover": settings.hover.button }),
    // The cookie popup's headings in the body text's font (D883); without it they take the headings' font.
    ...(settings.consent?.heading === "body" && { "data-consent-heading": "body" }),
    ...(settings.mode !== "auto" && { "data-color-mode": settings.mode }),
  };
}

// ---------------------------------------------------------------------------
// The page builder's Theme tab (D182)
// ---------------------------------------------------------------------------

/**
 * What the page builder's Theme tab edits of a theme (`src/lib/theme-elements.ts`): the elements, the content width in
 * pixels over the Narrow, Normal and Wide choice (null: the choice), and the body background of each colour set.
 */
export type ThemeTabValue = {
  elements: ThemeElements;
  /** The theme's section styles (D242), each a set of elements; none when empty. */
  sections?: SectionStyles;
  maxWidth: number | null;
  background: { light: string; dark: string };
  /** The site's hover timing and the buttons' default answer (D206); none set when empty. */
  hover?: ThemeHover;
};

export const themeTabValue = (settings: ThemeSettings): ThemeTabValue => ({
  elements: structuredClone(settings.elements ?? {}),
  sections: structuredClone(settings.sectionStyles ?? {}),
  maxWidth: settings.layout.maxWidth ?? null,
  background: { light: settings.light.background, dark: settings.dark.background },
  hover: settings.hover ? { ...settings.hover } : {},
});

/** The theme with the tab's value in it, and nothing else changed. */
export function withThemeTab(settings: ThemeSettings, value: ThemeTabValue): ThemeSettings {
  const { elements: _before, hover: _hover, sectionStyles: _sections, ...rest } = settings;
  void _before;
  void _hover;
  void _sections;
  const sections = Object.fromEntries(Object.entries(value.sections ?? {}).filter(([, style]) => style && Object.keys(style).length > 0));
  const hover = value.hover && Object.values(value.hover).some((v) => v !== undefined) ? value.hover : undefined;
  const { maxWidth: _width, ...layout } = settings.layout;
  void _width;
  return {
    ...rest,
    layout: { ...layout, ...(value.maxWidth !== null && { maxWidth: value.maxWidth }) },
    light: { ...settings.light, background: value.background.light },
    dark: { ...settings.dark, background: value.background.dark },
    ...(Object.keys(value.elements).length > 0 && { elements: value.elements }),
    ...(Object.keys(sections).length > 0 && { sectionStyles: sections }),
    ...(hover && { hover }),
  };
}

// ---------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG's contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The words `themeWarnings()` writes, in English unless an admin catalogue's `design.readability` is given (D312 A7). */
export const READABILITY_WORDS = {
  pairs: {
    textOnBackground: "Text on the background",
    mutedOnBackground: "Secondary text on the background",
    textOnSurface: "Text on the surface colour",
    textOnAccent: "Text on the accent colour",
  },
  sets: { light: "light", dark: "dark" },
  hard: "{what} in the {set} colours is hard to read ({ratio}:1; aim for 4.5:1).",
  decimal: ".",
};
export type ReadabilityWords = {
  pairs: { [K in keyof typeof READABILITY_WORDS.pairs]: string };
  sets: { light: string; dark: string };
  hard: string;
  decimal: string;
};

/**
 * Colour pairs that fall below WCAG AA for normal text (4.5:1), in the sets
 * the theme shows; the editor warns about them rather than refusing, so an
 * owner can work through a palette.
 */
/** What the readability warnings name the cookie popup's own colours (D883): `CONSENT_LOOK_WORDS.readability`, in the admin's language. */
export type ConsentReadabilityWords = { consentText: string; consentMuted: string; consentButton: string; consentSecondary: string };
const CONSENT_READABILITY: ConsentReadabilityWords = {
  consentText: "The cookie popup's text",
  consentMuted: "The cookie popup's secondary text",
  consentButton: "The cookie popup's main button",
  consentSecondary: "The cookie popup's other buttons",
};

export function themeWarnings(settings: ThemeSettings, w: ReadabilityWords = READABILITY_WORDS, cw: ConsentReadabilityWords = CONSENT_READABILITY): string[] {
  // Both sets show where the device decides or the visitor may choose (D99).
  const sets = settings.mode === "auto" || settings.visitorSwitch ? (["light", "dark"] as const) : ([settings.mode] as const);
  const pairs: [PaletteKey, PaletteKey, string][] = [
    ["text", "background", w.pairs.textOnBackground],
    ["muted", "background", w.pairs.mutedOnBackground],
    ["text", "surface", w.pairs.textOnSurface],
    ["accentText", "accent", w.pairs.textOnAccent],
  ];
  const hard = (a: string, b: string, what: string, set: "light" | "dark") => {
    const ratio = contrastRatio(a, b);
    return ratio < 4.5 ? [fillWords(w.hard, { what, set: w.sets[set], ratio: ratio.toFixed(1).replace(".", w.decimal) })] : [];
  };
  const palette = sets.flatMap((set) => pairs.flatMap(([a, b, what]) => hard(settings[set][a], settings[set][b], what, set)));
  // The cookie popup's own colours (D883), in the sets it shows; the theme's own are checked above.
  const own = settings.consent?.colours;
  if (!own) return palette;
  const shown = [...new Set(sets.map((set) => consentColours(settings, set).set))];
  const consentPairs: [ConsentColourKey, ConsentColourKey, string][] = [
    ["text", "background", cw.consentText],
    ["muted", "background", cw.consentMuted],
    ["buttonText", "button", cw.consentButton],
    ["secondaryText", "secondary", cw.consentSecondary],
  ];
  return [...palette, ...shown.flatMap((set) => consentPairs.flatMap(([a, b, what]) => hard(own[set][a], own[set][b], what, set)))];
}

// ---------------------------------------------------------------------------
// Logos on dark backgrounds
// ---------------------------------------------------------------------------

/** Where a logo sits: the header, or on the page itself (the footer, the phone's menu). */
export type LogoPlace = "header" | "page";

/** Whether white text reads better on a colour than black does. */
export const isDarkColor = (color: string) => contrastRatio(color, "#ffffff") > contrastRatio(color, "#000000");

function behindLogo(settings: ThemeSettings, place: LogoPlace, set: Palette): string {
  if (place === "page") return set.background;
  switch (settings.layout.headerBackground) {
    case "surface":
      return set.surface;
    case "accent":
      return set.accent;
    case "inverse":
      return set.text;
    default:
      return set.background;
  }
}

/**
 * Whether the colour behind a logo is dark in the theme's light colours and
 * in its dark ones (whichever the page shows: the store's mode, the
 * device's or the visitor's choice, D99): where it is, a store's logo for
 * dark backgrounds takes the place of its logo (D60).
 */
export function darkBehindLogo(settings: ThemeSettings, place: LogoPlace): { light: boolean; dark: boolean } {
  return {
    light: isDarkColor(behindLogo(settings, place, settings.light)),
    dark: isDarkColor(behindLogo(settings, place, settings.dark)),
  };
}
