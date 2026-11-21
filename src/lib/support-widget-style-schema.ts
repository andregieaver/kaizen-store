import { z } from "zod";

import { cssProblem } from "./custom-css";
import { FONT_FAMILY } from "./fonts";
import {
  GREETING_MAX,
  HEX,
  LABEL_MAX,
  OFFSET_MAX,
  WIDGET_CORNERS,
  WIDGET_CSS_MAX,
  WIDGET_LAUNCHERS,
  WIDGET_SIDES,
  WIDGET_WIDTHS,
} from "./support-widget-style";

/**
 * The schemas of support-widget-style.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; support-widget-style.ts imports it as a type alone.
 */

const colour = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (/^#[0-9a-f]{3}$/.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value))
  .pipe(z.string().regex(HEX))
  .nullable()
  .catch(null);

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
