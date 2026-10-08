import { z } from "zod";

/**
 * Colours with an opacity (D180, `docs/text-colour.md`): a colour is always stored as `#rrggbb` and an opacity as a whole
 * number from 0 to 100 (solid when left out). `colourCss()` is the one place either becomes CSS, for text (typography, the
 * rich text colour mark) and for rows' and columns' colour backgrounds alike; `blend()` is what the page checker reads a
 * see-through colour as over what is behind it. Pure, for the browser and the server.
 */

export const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** A colour as stored: `#rrggbb`. */
export const hexColour = z.string().regex(HEX6, "A colour is written as # and six hex digits, like #1f2937.");
/** An opacity as stored: 0 (invisible) to 100 (solid). */
export const opacityValue = z
  .number()
  .int("An opacity is a whole number from 0 to 100.")
  .min(0, "An opacity is 0 to 100.")
  .max(100, "An opacity is 0 to 100.");

/** Whether a value is an opacity as stored. */
export const isOpacity = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;

/**
 * A colour and its opacity as CSS: the colour itself when solid (no opacity, or 100), else the colour mixed with
 * transparent (`color-mix(in srgb, …)`, as backgrounds with an opacity always were drawn).
 */
export function colourCss(colour: string, opacity?: number | null): string {
  if (opacity === undefined || opacity === null || opacity >= 100) return colour;
  return `color-mix(in srgb, ${colour} ${opacity}%, transparent)`;
}

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (values: number[]) => `#${values.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/**
 * What a colour with an opacity looks like over a solid colour behind it, as `#rrggbb`: each channel mixed in sRGB by the
 * opacity, as the browser composites `colourCss()` over its background.
 */
export function blend(colour: string, opacity: number | undefined | null, over: string): string {
  if (opacity === undefined || opacity === null || opacity >= 100) return colour.toLowerCase();
  const a = Math.max(0, opacity) / 100;
  const top = channels(colour);
  const back = channels(over);
  return toHex(top.map((c, i) => c * a + back[i] * (1 - a)));
}

// ---------------------------------------------------------------------------
// The theme's colours, for the colour field's swatches
// ---------------------------------------------------------------------------

/** A colour offered beside a colour field: the theme's, with its name. */
export type ColourSwatch = { name: string; colour: string };

type PaletteLike = { background: string; surface: string; text: string; muted: string; border: string; accent: string; accentText: string };

const SWATCH_NAMES: [keyof PaletteLike, string][] = [
  ["text", "Text"],
  ["muted", "Secondary text"],
  ["accent", "Accent"],
  ["accentText", "Text on accent"],
  ["background", "Background"],
  ["surface", "Surface"],
  ["border", "Lines"],
];

/**
 * The swatches of a store's theme (D60): its light colours, and its dark ones too where the site shows them (a mode that
 * follows the visitor, or a visitor's switch). A colour the two share is offered once.
 */
export function themeSwatches(settings: { mode: "auto" | "light" | "dark"; visitorSwitch?: boolean; light: PaletteLike; dark: PaletteLike }): ColourSwatch[] {
  const both = settings.mode === "auto" || Boolean(settings.visitorSwitch);
  const sets: ("light" | "dark")[] = both ? ["light", "dark"] : [settings.mode as "light" | "dark"];
  const out: ColourSwatch[] = [];
  const seen = new Set<string>();
  for (const set of sets) {
    for (const [key, name] of SWATCH_NAMES) {
      const colour = settings[set][key].toLowerCase();
      if (!HEX6.test(colour) || seen.has(colour)) continue;
      seen.add(colour);
      out.push({ name: sets.length > 1 ? `${name} (${set})` : name, colour });
    }
  }
  return out;
}

/** Kaizen's own colours (`globals.css`'s `:root`, light and dark), the swatches of Kaizen's pages. */
export const PLATFORM_PALETTE: { light: PaletteLike; dark: PaletteLike } = {
  light: { background: "#ffffff", surface: "#f5f5f4", text: "#171717", muted: "#525252", border: "#e5e5e5", accent: "#171717", accentText: "#ffffff" },
  dark: { background: "#0a0a0a", surface: "#1c1c1c", text: "#ededed", muted: "#a3a3a3", border: "#2e2e2e", accent: "#ededed", accentText: "#0a0a0a" },
};

export const platformSwatches = (): ColourSwatch[] => themeSwatches({ mode: "auto", ...PLATFORM_PALETTE });
