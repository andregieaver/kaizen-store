import type { SectionStyles } from "./section-styles";

/**
 * The kit for writing a theme as data (`docs/signature-themes.md` step 1): the spacing, sizes and core section styles every Kaizena theme is
 * written with, shared by the launch themes (`src/lib/launch-themes.ts`) and the signature themes (`src/lib/signature/`). Pure.
 */

/** Room above and below (and at the sides) of a row or element, in pixels. */
export const pad = (y: number, x = 20) => ({ padding: { top: y, right: x, bottom: y, left: x } });
/** A size in rem. */
export const rem = (value: number) => ({ value, unit: "rem" as const });
/** A size in pixels. */
export const px = (value: number) => ({ value, unit: "px" as const });
/** A size in em (letter spacing). */
export const em = (value: number) => ({ value, unit: "em" as const });
/** A line height with no unit. */
export const lines = (value: number) => ({ value, unit: "" as const });

/**
 * The core section styles, so rows naming them look as intended in every Kaizena theme: room for the hero, a quiet tint for muted that works
 * on light and dark pages alike (a see-through grey over the page), a fixed dark band for contrast with its own light text, and larger
 * italic text for quotes.
 */
export function coreStyles(look: { heroSize: number; band: string; bandText: string; space: number; quoteFamily?: string }): SectionStyles {
  return {
    plain: { row: { style: pad(look.space) } },
    hero: {
      row: { style: pad(look.space * 2) },
      h1: { typography: { text: { size: rem(look.heroSize), lineHeight: lines(1.1) } } },
      p: { typography: { text: { size: rem(1.25) } } },
    },
    feature: {
      row: { style: pad(Math.round(look.space * 1.25)) },
      h3: { typography: { text: { size: rem(1.375) } } },
    },
    muted: { row: { style: pad(look.space), background: { type: "color", color: "#808080", opacity: 10 } } },
    contrast: {
      row: { style: pad(Math.round(look.space * 1.25)), background: { type: "color", color: look.band }, typography: { text: { color: look.bandText } } },
    },
    quote: {
      row: { style: pad(look.space) },
      p: { typography: { text: { size: rem(1.5), style: "italic", lineHeight: lines(1.4), ...(look.quoteFamily && { family: look.quoteFamily }) } } },
    },
  };
}
