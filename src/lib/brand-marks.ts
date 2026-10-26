import { z } from "zod";

import { contrastRatio, type Palette } from "./theme";

/**
 * The brand's logo and icon drawn by code (D330 F2a, `docs/ai-autopilot.md` 14.3): a wordmark of the brand's name and a monogram on the
 * accent, from the outlines of the brand's own font. Pure: the input, the letters, the colours and the SVG, which holds only paths and fills
 * (no text, no font, no link), so nothing in it can run or reach anywhere. `src/server/brand-marks.ts` renders it and keeps the files.
 */

/** WCAG's line for graphics: a mark against its background. */
export const MARK_CONTRAST = 3;
/** The logo's height in pixels as kept, and its small copy's. */
export const LOGO_HEIGHT = 192;
export const LOGO_SMALL_HEIGHT = 96;
/** The icon's sizes: the site's icon and its small copy (D62). */
export const ICON_SIZE = 512;
export const ICON_SMALL_SIZE = 64;
/** The family a mark is drawn in when the theme uses the device's own fonts. */
export const DEFAULT_MARK_FONT = "Inter";

export const ICON_SHAPES = ["circle", "rounded", "square"] as const;
export type IconShape = (typeof ICON_SHAPES)[number];

export const brandMarksInput = z.object({
  text: z.string().trim().min(1).max(40).optional().describe("The words of the logo; the store's name unless given."),
  font: z.string().trim().min(1).max(100).optional().describe("A font family from Google Fonts' catalogue; the theme's heading font unless given."),
  weight: z.number().int().min(100).max(900).multipleOf(100).optional().describe("The font's weight, 100 to 900; 700 unless given."),
  colour: z.enum(["text", "accent"]).default("text").describe("The logo in the theme's text colour or its accent."),
  icon_shape: z.enum(ICON_SHAPES).default("rounded"),
  icon_letters: z
    .string()
    .trim()
    .min(1)
    .max(2)
    .optional()
    .describe("One or two letters for the icon; the name's initials unless given."),
});
export type BrandMarksInput = z.infer<typeof brandMarksInput>;

/** The icon's letters: the first letter of the first two words, in capitals (one word gives one). */
export function monogramOf(name: string): string {
  const words = name
    .normalize("NFC")
    .split(/[\s\-–—_./&+]+/)
    .map((w) => [...w].find((c) => /\p{L}|\p{N}/u.test(c)))
    .filter((c): c is string => Boolean(c));
  return words
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase();
}

/** The colour of a mark over a ground: the one asked for when it reaches 3:1 against the ground, else the palette's text colour. */
export function markColour(palette: Palette, ground: string, wanted: "text" | "accent"): string {
  const first = wanted === "accent" ? palette.accent : palette.text;
  return contrastRatio(first, ground) >= MARK_CONTRAST ? first : palette.text;
}

export type Box = { x1: number; y1: number; x2: number; y2: number };

const round = (n: number) => Math.round(n * 100) / 100;
const colourOk = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
/** Path data is only commands and numbers: anything else is refused, so the SVG holds nothing but shapes. */
export const pathOk = (d: string) => /^[MLHVCSQTAZmlhvcsqtaz0-9.,\-\s e]*$/.test(d) && d.trim().length > 0;

/** The wordmark: the name's outlines filled, with a little room around them, on no background. */
export function wordmarkSvg(path: string, box: Box, colour: string): string {
  if (!pathOk(path) || !colourOk(colour)) throw new Error("A mark is only paths and a colour.");
  const height = box.y2 - box.y1;
  const pad = round(height * 0.12);
  const view = [round(box.x1 - pad), round(box.y1 - pad), round(box.x2 - box.x1 + pad * 2), round(height + pad * 2)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(" ")}"><path d="${path}" fill="${colour}"/></svg>`;
}

/** The icon: the letters' outlines centred on the accent in its shape, at `ICON_SIZE`. */
export function iconSvg(path: string, box: Box, ground: string, ink: string, shape: IconShape): string {
  if (!pathOk(path) || !colourOk(ground) || !colourOk(ink)) throw new Error("A mark is only paths and colours.");
  const size = ICON_SIZE;
  const room = size * (shape === "circle" ? 0.5 : 0.56);
  const scale = Math.min(room / (box.x2 - box.x1), room / (box.y2 - box.y1));
  const dx = round(size / 2 - ((box.x1 + box.x2) / 2) * scale);
  const dy = round(size / 2 - ((box.y1 + box.y2) / 2) * scale);
  const back =
    shape === "circle"
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${ground}"/>`
      : `<rect width="${size}" height="${size}" rx="${shape === "rounded" ? size * 0.22 : 0}" fill="${ground}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${back}<path d="${path}" fill="${ink}" transform="translate(${dx} ${dy}) scale(${round(scale)})"/></svg>`;
}

/** The letters on the accent: the palette's text on accent (which the theme holds readable, D330 F1), else white or ink, whichever reads best. */
export function iconInk(palette: Palette): string {
  if (contrastRatio(palette.accentText, palette.accent) >= MARK_CONTRAST) return palette.accentText;
  return contrastRatio("#ffffff", palette.accent) >= contrastRatio("#111111", palette.accent) ? "#ffffff" : "#111111";
}
