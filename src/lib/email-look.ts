/**
 * A marketing email's look from the store's theme (email plan M4.1): its buttons in the theme's accent colour with the text colour it sets
 * for them, and their corners as the theme's buttons (square, rounded or pill). A theme whose two colours do not contrast enough for text
 * (4.5 to 1, WCAG AA) keeps the default black and white, so an email is never hard to read. Pure.
 */

export type EmailLook = { accent: string; onAccent: string; radius: string };

export const DEFAULT_EMAIL_LOOK: EmailLook = { accent: "#171717", onAccent: "#ffffff", radius: "999px" };

const RADIUS = { square: "0", rounded: "8px", pill: "999px" } as const;

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

/** The look from a theme's light palette and button corners; the default where the colours are missing, not plain hex or too faint. */
export function emailLook(theme: { light?: { accent?: string; accentText?: string }; buttons?: { corners?: string } } | null): EmailLook {
  const accent = theme?.light?.accent ?? "";
  const onAccent = theme?.light?.accentText ?? "";
  const radius = RADIUS[(theme?.buttons?.corners ?? "pill") as keyof typeof RADIUS] ?? DEFAULT_EMAIL_LOOK.radius;
  if (!HEX.test(accent) || !HEX.test(onAccent) || contrast(accent, onAccent) < 4.5) return { ...DEFAULT_EMAIL_LOOK, radius };
  return { accent, onAccent, radius };
}
