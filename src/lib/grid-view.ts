import { sourceTraits } from "./grid-source";
import type { ContentGridBlock, PartBase } from "./page-content";
import type { Sides } from "./part-styles";

/**
 * What a content grid's tiles (`components/content-grid-tiles.tsx`) read of the page model to draw: a card's content space, a part's
 * frame and a grid's picture shape, with the shadows they draw. Plain functions with no schema, so the tiles a recommending grid loads
 * in the browser carry neither zod nor the page model (bloat review step 2.10, D211); `page-content.ts` and `part-styles.ts` re-export
 * every name here.
 */

/** Shadows to choose from (D49), each with its CSS. */
export const SHADOWS = {
  sm: { label: "Small", css: "0 1px 3px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.08)" },
  md: { label: "Medium", css: "0 4px 12px rgb(0 0 0 / 0.12)" },
  lg: { label: "Large", css: "0 10px 30px rgb(0 0 0 / 0.15)" },
  xl: { label: "Extra large", css: "0 20px 50px rgb(0 0 0 / 0.2)" },
} as const;

export type Shadow = keyof typeof SHADOWS;

/** A shadow's opacity as a slider shows it, in per cent: its darkest layer's (D262). */
export const shadowOpacityOf = (shadow: Shadow): number => Math.round(Math.max(...shadowAlphas(SHADOWS[shadow].css)) * 100);
const shadowAlphas = (css: string) => [...css.matchAll(/\/ ([\d.]+)\)/g)].map((match) => Number(match[1]));

/**
 * A shadow's CSS (D49), at an opacity of its own where one is set (D262): its darkest layer at that opacity, the others in the same
 * proportion, so a shadow can be fainter or darker than it comes.
 */
export function shadowCss(shadow: Shadow, opacity?: number | null): string {
  const css = SHADOWS[shadow].css;
  if (opacity === undefined || opacity === null) return css;
  const darkest = Math.max(...shadowAlphas(css));
  return css.replace(/\/ ([\d.]+)\)/g, (_, alpha: string) => `/ ${Math.round(((Number(alpha) / darkest) * opacity) / 100 * 1000) / 1000})`);
}

/** A card's content space as four sides, or none when it is zero everywhere. */
export function contentSides(padding: number | Sides | undefined): Sides | null {
  if (padding === undefined) return null;
  const sides = typeof padding === "number" ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  return sides.top + sides.right + sides.bottom + sides.left > 0 ? sides : null;
}

/** CSS for a part's border, rounded corners and shadow (D49); nothing for what it does not have. */
export function frameStyle(part: Pick<PartBase, "border" | "radius" | "shadow" | "shadowOpacity">): Record<string, string> {
  const css: Record<string, string> = {};
  if (part.border) {
    css.borderStyle = part.border.style;
    css.borderColor = part.border.color;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      css[`border${side[0].toUpperCase()}${side.slice(1)}Width`] = `${part.border.width[side]}px`;
    }
  }
  if (part.radius) css.borderRadius = `${part.radius}px`;
  if (part.shadow) css.boxShadow = shadowCss(part.shadow, part.shadowOpacity);
  return css;
}

/** How a grid's pictures are cropped: its own choice, else the theme's cards for products (D60) and landscape for the rest. */
export const gridImageShape = (block: Pick<ContentGridBlock, "imageShape" | "source">) =>
  block.imageShape ?? (sourceTraits(block.source).products ? "theme" : "landscape");
