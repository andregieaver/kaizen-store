import { textOn } from "./social-links";
import type { WidgetStyle } from "./support-widget-style-schema";

export type { WidgetStyle } from "./support-widget-style-schema";

/**
 * A chat widget's own look (D582, `docs/support-embed.md` 2), so the chat matches the website it sits on whatever its design. Every
 * choice is optional: left out, the widget looks like the store's own chat (its theme's colours, corners and fonts). Homer picks a button
 * colour and maybe a side; Lisa has the panel's colours, corners, where the button sits to the pixel, its words, the panel's width, a
 * font, the greeting and CSS of her own, which runs only inside the chat's frame.
 */

export const HEX = /^#[0-9a-f]{6}$/;

export const WIDGET_CORNERS = ["store", "square", "soft", "round"] as const;
export const WIDGET_SIDES = ["right", "left"] as const;
export const WIDGET_LAUNCHERS = ["icon", "label"] as const;
export const WIDGET_WIDTHS = ["narrow", "standard", "wide"] as const;

/** The panel's width on a large screen, in pixels (a phone always gets the whole screen). */
export const PANEL_WIDTH: Record<(typeof WIDGET_WIDTHS)[number], number> = { narrow: 320, standard: 384, wide: 448 };
export const OFFSET_MAX = 200;
export const LABEL_MAX = 40;
export const GREETING_MAX = 300;
export const WIDGET_CSS_MAX = 20_000;

const RADII: Record<Exclude<(typeof WIDGET_CORNERS)[number], "store">, { button: string; card: string; field: string; launcher: string }> = {
  square: { button: "0", card: "0", field: "0", launcher: "0" },
  soft: { button: "0.5rem", card: "0.75rem", field: "0.5rem", launcher: "1rem" },
  round: { button: "9999px", card: "1.25rem", field: "0.75rem", launcher: "9999px" },
};

/**
 * The widget's look as CSS on `scope`, the element around the chat (in the frame, and in the admin's preview): its colours as the variables
 * the chat's classes read, mixed shades for the rest, its corners, and the button in the button colour. On the element itself, so it wins
 * over the store's theme on the page's root in light and dark alike. A font's stack is the caller's (`fontStack` needs the catalogue).
 */
export function widgetCss(style: WidgetStyle, scope: string, fontFamily: string | null = null): string {
  const vars: string[] = [];
  if (style.accent) vars.push(`--accent: ${style.accent}`, `--accent-foreground: ${textOn(style.accent)}`);
  if (style.background) vars.push(`--background: ${style.background}`);
  if (style.text) vars.push(`--foreground: ${style.text}`);
  if (style.background || style.text) {
    vars.push(
      "--surface: color-mix(in oklab, var(--foreground) 7%, var(--background))",
      "--border: color-mix(in oklab, var(--foreground) 15%, var(--background))",
      "--muted: color-mix(in oklab, var(--foreground) 68%, var(--background))",
    );
  }
  if (style.corners !== "store") {
    const r = RADII[style.corners];
    vars.push(`--button-radius: ${r.button}`, `--radius-button: ${r.button}`, `--radius-lg: ${r.card}`, `--radius-md: ${r.field}`);
  }
  const rules = [`${scope} { ${[...vars, ...(fontFamily ? [`font-family: ${fontFamily}`] : [])].join("; ")} }`];
  if (style.accent) rules.push(`${scope} [data-chat-launcher] { background: var(--accent); color: var(--accent-foreground); }`);
  if (style.corners !== "store") rules.push(`${scope} [data-chat-launcher], ${scope} [data-chat-launcher] [data-chat-avatar] { border-radius: ${RADII[style.corners].launcher}; }`);
  return rules.join("\n");
}

/** The colour a picker shows for a choice left to the store: its theme's, so the owner sees what they are changing. */
export const shownColour = (value: string | null, fallback: string): string => value ?? (HEX.test(fallback) ? fallback : "#000000");
