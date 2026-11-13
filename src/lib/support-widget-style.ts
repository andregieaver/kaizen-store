import { z } from "zod";

import { cssProblem } from "./custom-css";
import { FONT_FAMILY } from "./fonts";
import { textOn } from "./social-links";

/**
 * A chat widget's own look (D582, `docs/support-embed.md` 2), so the chat matches the website it sits on whatever its design. Every
 * choice is optional: left out, the widget looks like the store's own chat (its theme's colours, corners and fonts). Homer picks a button
 * colour and maybe a side; Lisa has the panel's colours, corners, where the button sits to the pixel, its words, the panel's width, a
 * font, the greeting and CSS of her own, which runs only inside the chat's frame.
 */

const HEX = /^#[0-9a-f]{6}$/;
const colour = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (/^#[0-9a-f]{3}$/.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value))
  .pipe(z.string().regex(HEX))
  .nullable()
  .catch(null);

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

const offset = z.coerce.number().int().min(0).max(OFFSET_MAX).catch(16);

export const widgetStyleSchema = z.object({
  /** The button and the main actions; the text on them is black or white, whichever reads (`textOn()`). */
  accent: colour.default(null),
  /** The panel's background and its text; the softer shades (bubbles, borders, hints) are mixed from the two. */
  background: colour.default(null),
  text: colour.default(null),
  corners: z.enum(WIDGET_CORNERS).catch("store").default("store"),
  side: z.enum(WIDGET_SIDES).catch("right").default("right"),
  /** From the window's side and bottom edge to the button, in pixels. */
  offsetX: offset.default(16),
  offsetY: offset.default(16),
  /** A round button with the chat's icon, or the icon and words beside it. */
  launcher: z.enum(WIDGET_LAUNCHERS).catch("icon").default("icon"),
  /** The button's words (else the chat's own, *Chat with us*), also read out by screen readers. */
  label: z.string().trim().max(LABEL_MAX).catch("").default(""),
  width: z.enum(WIDGET_WIDTHS).catch("standard").default("standard"),
  /** A family of the font catalogue (installed when saved), else the store's own font. */
  font: z.string().trim().regex(FONT_FAMILY).nullable().catch(null).default(null),
  /** The first words in the chat (else the desk's own greeting). Shown to the visitor only: never part of the AI's prompt. */
  greeting: z.string().trim().max(GREETING_MAX).catch("").default(""),
  /** CSS of the owner's own, run only inside the chat's frame, after everything else. */
  css: z.string().max(WIDGET_CSS_MAX).catch("").default(""),
});

export type WidgetStyle = z.output<typeof widgetStyleSchema>;

/** The look of a widget nobody styled: the store's own chat. */
export const DEFAULT_STYLE: WidgetStyle = widgetStyleSchema.parse({});

/** A stored style read back: anything unreadable falls back to its default, so a widget always draws. */
export const readStyle = (raw: unknown): WidgetStyle => widgetStyleSchema.parse(raw && typeof raw === "object" ? raw : {});

/** What is wrong with a style the owner sent, in a word the admin turns into a sentence; null when it can be saved. */
export function styleProblem(raw: Record<string, unknown>): "colour" | "css" | "label" | "greeting" | null {
  for (const key of ["accent", "background", "text"] as const) {
    const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (value && colour.parse(value) === null) return "colour";
  }
  if (typeof raw.label === "string" && raw.label.trim().length > LABEL_MAX) return "label";
  if (typeof raw.greeting === "string" && raw.greeting.trim().length > GREETING_MAX) return "greeting";
  if (typeof raw.css === "string" && raw.css.trim() && (raw.css.length > WIDGET_CSS_MAX || cssProblem(raw.css) !== null)) return "css";
  return null;
}

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
