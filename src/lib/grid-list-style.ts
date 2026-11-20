import { SIZES, type Size } from "./breakpoints";
import type { ContentGridBlock } from "./page-content";
import { carouselAnywhere, carouselAt, valueAt } from "./responsive";

/**
 * A part stylesheet's rules and how a rule class is named (`part-css.ts`, D179), with a content grid's list (`gridListStyle()`): in a
 * module with no schema and no page model, so the tiles a recommending grid loads in the browser carry neither (bloat review step 2.10).
 * `part-css.ts` re-exports every name here.
 */

export type Decl = Record<string, string>;

/**
 * One rule of a part. `sizes` holds what it says at each size (the whole of it); it is written as the base and, for each
 * smaller size, only what differs from the size above it (`upTo` queries), so it reads as `valueAt()` walks. `only` rules
 * hold at the sizes named and nowhere else (one condition per run of neighbouring sizes).
 */
export type PartRule =
  | { selector: string; important: boolean; where: boolean; sizes: Record<Size, Decl> }
  | { selector: string; important: false; where: boolean; only: Size[]; decl: Decl };

/** An element's class and its rules, `&` standing for the class until it is named. */
export type ElementStyle = { className: string; rules: PartRule[] };

export const NONE: ElementStyle = { className: "", rules: [] };

export const perSize = (decl: (size: Size) => Decl): Record<Size, Decl> => Object.fromEntries(SIZES.map((size) => [size, decl(size)])) as Record<Size, Decl>;
export const isEmpty = (sizes: Record<Size, Decl>) => SIZES.every((size) => Object.keys(sizes[size]).length === 0);

/** FNV-1a, twice with other starting values: 64 bits, written short. */
function hash(text: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x9e3779b9]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(36);
  }
  return out;
}

/** The element's class named by what its rules say; none when they say nothing. */
export function named(rules: PartRule[], suffix = ""): ElementStyle {
  const kept = rules.filter((rule) => ("sizes" in rule ? !isEmpty(rule.sizes) : Object.keys(rule.decl).length > 0 && rule.only.length > 0));
  if (kept.length === 0) return NONE;
  const className = `kzr-${hash(JSON.stringify(kept))}${suffix}`;
  return { className, rules: kept.map((rule) => ({ ...rule, selector: rule.selector.replaceAll("&", `.${className}`) })) };
}

/**
 * A content grid's list of tiles (D51): its columns and gap at each size (custom properties the list reads, which were
 * inline), and where it is a carousel at some sizes, a grid of the same columns at the others (the track's own rules are
 * in globals.css, which these beat by naming the track too). Drawn wherever the grid is, in a row or a listing.
 */
export function gridListStyle(block: ContentGridBlock): ElementStyle {
  const rules: PartRule[] = [
    {
      selector: "&",
      important: true,
      where: true,
      sizes: perSize((size) => ({ "--grid-cols": String(valueAt(block, "columns", size) ?? block.columns), "--grid-gap": `${valueAt(block, "gap", size) ?? block.gap}px` })),
    },
  ];
  if (carouselAnywhere(block)) {
    const grid = SIZES.filter((size) => !carouselAt(block, size));
    if (grid.length > 0) {
      rules.push(
        {
          selector: "&[data-carousel-track]",
          important: false,
          where: false,
          only: grid,
          decl: { display: "grid", "grid-template-columns": "repeat(var(--cols), minmax(0, 1fr))", "overflow-x": "visible", "scroll-snap-type": "none" },
        },
        { selector: "&[data-carousel-track] > *", important: false, where: false, only: grid, decl: { flex: "none" } },
        { selector: "& ~ [data-carousel-controls]", important: false, where: false, only: grid, decl: { display: "none" } },
      );
    }
  }
  return named(rules, "-l");
}
