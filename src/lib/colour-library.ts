import { z } from "zod";

import {
  GRADIENT_COLORS_MAX,
  GRADIENT_COLORS_MIN,
  GRADIENT_FLOWS,
  GRADIENT_STYLES,
  type GradientFlow,
  type GradientStyle,
} from "./motion";

/**
 * A store's saved colours and gradients (D183): named, kept on its theme (`ThemeSettings.library`) and offered in every colour
 * field and gradient editor of the page builder. Using one is a copy: the colour or gradient is written into the part as it
 * is, so changing or deleting a saved one never changes a page. Pure, for the browser and the server.
 */

export const LIBRARY_NAME_MAX = 40;
export const SAVED_COLOURS_MAX = 40;
export const SAVED_GRADIENTS_MAX = 20;

export type SavedColour = { id: string; name: string; color: string };
/** A gradient to use again: a background's own settings (not its overlay or opacity, which belong to the place it is used), or a text's colours and angle. */
export type SavedGradient = {
  id: string;
  name: string;
  style: GradientStyle;
  colors: string[];
  angle?: number;
  flow?: GradientFlow;
  grain?: boolean;
};
export type ColourLibrary = { colours: SavedColour[]; gradients: SavedGradient[] };

export const EMPTY_LIBRARY: ColourLibrary = { colours: [], gradients: [] };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const name = z.string().trim().min(1, "Give it a name.").max(LIBRARY_NAME_MAX, `Keep the name under ${LIBRARY_NAME_MAX} characters.`);

export const colourLibrarySchema = z.object({
  colours: z.array(z.object({ id: itemId, name, color: hex })).max(SAVED_COLOURS_MAX, `Keep at most ${SAVED_COLOURS_MAX} saved colours.`),
  gradients: z
    .array(
      z.object({
        id: itemId,
        name,
        style: z.enum(Object.keys(GRADIENT_STYLES) as [GradientStyle, ...GradientStyle[]]),
        colors: z.array(hex).min(GRADIENT_COLORS_MIN).max(GRADIENT_COLORS_MAX),
        angle: z.number().int().min(0).max(360).optional(),
        flow: z.enum(Object.keys(GRADIENT_FLOWS) as [GradientFlow, ...GradientFlow[]]).optional(),
        grain: z.boolean().optional(),
      }),
    )
    .max(SAVED_GRADIENTS_MAX, `Keep at most ${SAVED_GRADIENTS_MAX} saved gradients.`),
});

/** A name as it is kept: trimmed and cut, or the fallback when nothing is left. */
export const libraryName = (text: string, fallback: string): string => text.trim().slice(0, LIBRARY_NAME_MAX) || fallback;

/** CSS for colours shown as a straight gradient (a saved gradient's swatch, a text gradient). */
export const linearGradient = (colors: readonly string[], angle = 135): string => `linear-gradient(${angle}deg, ${colors.join(", ")})`;

/** The library with a colour added; the same colour under the same name is not added twice, and a full list is left as it is (`full`). */
export function withSavedColour(library: ColourLibrary, colour: SavedColour): { library: ColourLibrary; full: boolean } {
  if (library.colours.some((c) => c.color === colour.color && c.name === colour.name)) return { library, full: false };
  if (library.colours.length >= SAVED_COLOURS_MAX) return { library, full: true };
  return { library: { ...library, colours: [...library.colours, { ...colour, color: colour.color.toLowerCase() }] }, full: false };
}

export function withSavedGradient(library: ColourLibrary, gradient: SavedGradient): { library: ColourLibrary; full: boolean } {
  if (library.gradients.length >= SAVED_GRADIENTS_MAX) return { library, full: true };
  return { library: { ...library, gradients: [...library.gradients, gradient] }, full: false };
}

export const withoutSaved = (library: ColourLibrary, kind: "colour" | "gradient", id: string): ColourLibrary =>
  kind === "colour"
    ? { ...library, colours: library.colours.filter((c) => c.id !== id) }
    : { ...library, gradients: library.gradients.filter((g) => g.id !== id) };

/** A background gradient's own settings as a saved gradient (the overlay and opacity stay with the place). */
export function savedFromBackground(
  gradient: { style: GradientStyle; colors: string[]; angle?: number; flow?: GradientFlow; grain?: boolean },
  id: string,
  title: string,
): SavedGradient {
  return {
    id,
    name: title,
    style: gradient.style,
    colors: [...gradient.colors],
    ...(gradient.angle !== undefined && { angle: gradient.angle }),
    ...(gradient.flow !== undefined && { flow: gradient.flow }),
    ...(gradient.grain && { grain: true }),
  };
}
