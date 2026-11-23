/**
 * A marketing email's look from the store's theme (email plan M4.1): its buttons in the theme's accent colour with the text colour it sets
 * for them, and their corners as the theme's buttons (square, rounded or pill); the page and card colours, the words' and quiet words'
 * colours and the lines', from the theme's light palette; its headings' weight and case; its cards' corners; and its fonts, named first
 * with the email's usual system fonts after them (most mail apps load no web font, so the system font is what most readers see). Every
 * pair of colours that carries words must contrast 4.5 to 1 (WCAG AA), or that part keeps the default, so an email is never hard to read.
 * The theme has no spacing of its own, so the email keeps its spacing. Pure.
 */

export type EmailLook = {
  accent: string;
  onAccent: string;
  radius: string;
  /** Around the card, and the card. */
  page: string;
  card: string;
  /** Words, quiet words (the footer, a product's small lines) and lines. */
  text: string;
  muted: string;
  /** The words under the card, on the page colour. */
  footer: string;
  border: string;
  /** The card's and pictures' corners. */
  cardRadius: string;
  headingWeight: number;
  headingUpper: boolean;
  /** Font stacks, the theme's font first. */
  headingFont: string;
  bodyFont: string;
};

const SYSTEM_FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const DEFAULT_EMAIL_LOOK: EmailLook = {
  accent: "#171717",
  onAccent: "#ffffff",
  radius: "999px",
  page: "#f5f5f4",
  card: "#ffffff",
  text: "#171717",
  muted: "#525252",
  footer: "#525252",
  border: "#e5e5e5",
  cardRadius: "12px",
  headingWeight: 700,
  headingUpper: false,
  headingFont: SYSTEM_FONT,
  bodyFont: SYSTEM_FONT,
};

const RADIUS = { square: "0", rounded: "8px", pill: "999px" } as const;
const CARD_RADIUS = { none: "0", small: "4px", medium: "8px", large: "16px" } as const;
const WEIGHTS = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast of two hex colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A font family name as the theme keeps it, first in a stack; anything but letters, digits, spaces and hyphens keeps the system's. */
const stack = (family: string | undefined) => (family && /^[A-Za-z0-9 -]{1,60}$/.test(family) ? `'${family}', ${SYSTEM_FONT}` : SYSTEM_FONT);

type ThemeLike = {
  light?: { accent?: string; accentText?: string; background?: string; surface?: string; text?: string; muted?: string; border?: string };
  buttons?: { corners?: string };
  corners?: { cards?: string };
  headings?: { weight?: string; case?: string };
  fonts?: { heading?: string; body?: string };
};

/** The look from a theme's settings; each part the default where it is missing, not plain hex or too faint to read. */
export function emailLook(theme: ThemeLike | null): EmailLook {
  const d = DEFAULT_EMAIL_LOOK;
  const light = theme?.light ?? {};
  const ok = (colour: string | undefined): colour is string => Boolean(colour && HEX.test(colour));
  const radius = RADIUS[(theme?.buttons?.corners ?? "pill") as keyof typeof RADIUS] ?? d.radius;
  const button = ok(light.accent) && ok(light.accentText) && contrast(light.accent, light.accentText) >= 4.5 ? { accent: light.accent, onAccent: light.accentText } : { accent: d.accent, onAccent: d.onAccent };
  // The card and its words go together: a theme card the words cannot be read on keeps both of the defaults.
  const card = ok(light.background) && ok(light.text) && contrast(light.background, light.text) >= 4.5 ? { card: light.background, text: light.text } : { card: d.card, text: d.text };
  const muted = ok(light.muted) && contrast(light.muted, card.card) >= 4.5 ? light.muted : contrast(d.muted, card.card) >= 4.5 ? d.muted : card.text;
  const page = ok(light.surface) && light.surface !== card.card ? light.surface : card.card === d.card ? d.page : card.card;
  return {
    ...button,
    radius,
    page,
    ...card,
    muted,
    footer: [muted, card.text, d.text].find((c) => contrast(c, page) >= 4.5) ?? d.text,
    border: ok(light.border) ? light.border : d.border,
    cardRadius: CARD_RADIUS[(theme?.corners?.cards ?? "") as keyof typeof CARD_RADIUS] ?? d.cardRadius,
    headingWeight: WEIGHTS[(theme?.headings?.weight ?? "") as keyof typeof WEIGHTS] ?? d.headingWeight,
    headingUpper: theme?.headings?.case === "upper",
    headingFont: stack(theme?.fonts?.heading),
    bodyFont: stack(theme?.fonts?.body),
  };
}
