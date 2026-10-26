/**
 * The product editor's variant grid at scale (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.4): which variants the filter shows, and what
 * *Set for all shown* writes on them. Pure, so the browser and the tests share it; no zod, nothing of the server.
 */

/** A variant as the grid reads and writes it: the fields *Set for all shown* can change, and its option values. */
export type GridVariant = {
  options: Record<string, string>;
  sku: string;
  prices: Record<string, string>;
  stock: number;
  weightGrams: number | null;
  active: boolean;
  delivery: string;
};

/** Per option name, the one value shown; an option left out (or empty) shows every value. */
export type VariantFilter = Record<string, string>;

/** From this many variants the editor offers the filter and draws only the rows on screen; Homer's product, with fewer, is drawn whole. */
export const GRID_FROM = 13;

/** The positions of the variants the filter shows, in their order. */
export function filterVariants(variants: readonly GridVariant[], filter: VariantFilter): number[] {
  const wanted = Object.entries(filter).filter(([, value]) => value !== "");
  const shown: number[] = [];
  variants.forEach((variant, index) => {
    if (wanted.every(([name, value]) => variant.options[name] === value)) shown.push(index);
  });
  return shown;
}

/** What *Set for all shown* writes: only what was filled in. */
export type GridChange = {
  /** A price per market code; a market left out (or empty) keeps each variant's own. */
  prices?: Record<string, string>;
  stock?: number;
  /** A SKU pattern (`skuFromPattern()`); empty keeps each variant's own. */
  skuPattern?: string;
  weightGrams?: number;
  active?: boolean;
};

/** A word as it goes into a SKU: upper case, letters and digits, a hyphen for anything between. */
export function skuWord(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A variant's SKU from a pattern: `{handle}` is the product's web address, `{n}` its place in the list (1, 2, …), and `{Colour}` (any option's
 * name, in any case) its value for that option, each as a SKU word. Anything else is kept as typed. At most 64 characters, as a SKU.
 */
export function skuFromPattern(pattern: string, handle: string, options: Record<string, string>, place: number): string {
  const byName = new Map(Object.entries(options).map(([name, value]) => [name.trim().toLowerCase(), value]));
  return pattern
    .replace(/\{([^{}]+)\}/g, (whole, token: string) => {
      const name = token.trim().toLowerCase();
      if (name === "handle") return skuWord(handle);
      if (name === "n") return String(place);
      const value = byName.get(name);
      return value === undefined ? whole : skuWord(value);
    })
    .trim()
    .slice(0, 64);
}

/** Why a pattern would not do for the variants shown: a token no option has, or two variants given the same SKU. Null when it would. */
export function skuPatternProblem(
  pattern: string,
  handle: string,
  variants: readonly GridVariant[],
  shown: readonly number[],
): { kind: "unknown"; token: string } | { kind: "repeats"; sku: string } | null {
  const names = new Set(variants.flatMap((v) => Object.keys(v.options)).map((name) => name.trim().toLowerCase()));
  for (const [, token] of pattern.matchAll(/\{([^{}]+)\}/g)) {
    const name = token.trim().toLowerCase();
    if (name !== "handle" && name !== "n" && !names.has(name)) return { kind: "unknown", token };
  }
  // The SKUs of every variant as they would be: those shown from the pattern, the others as they are.
  const target = new Set(shown);
  const seen = new Set<string>();
  for (const [index, variant] of variants.entries()) {
    const sku = (target.has(index) ? skuFromPattern(pattern, handle, variant.options, index + 1) : variant.sku).toLowerCase();
    if (sku === "") continue;
    if (seen.has(sku)) return { kind: "repeats", sku };
    seen.add(sku);
  }
  return null;
}

/**
 * The variants with the change laid over those shown. Stock and weight are written only on variants that are shipped (a download keeps
 * none), as the editor's own fields do. A new list; those not shown are the same objects.
 */
export function setForShown<V extends GridVariant>(variants: readonly V[], shown: readonly number[], change: GridChange, handle: string): V[] {
  const target = new Set(shown);
  const prices = Object.entries(change.prices ?? {}).filter(([, value]) => value.trim() !== "");
  const pattern = change.skuPattern?.trim() ?? "";
  return variants.map((variant, index) => {
    if (!target.has(index)) return variant;
    const shipped = variant.delivery === "physical";
    return {
      ...variant,
      ...(prices.length > 0 ? { prices: { ...variant.prices, ...Object.fromEntries(prices.map(([code, value]) => [code, value.trim()])) } } : {}),
      ...(change.stock !== undefined && shipped ? { stock: Math.max(0, Math.floor(change.stock)) } : {}),
      ...(change.weightGrams !== undefined && shipped ? { weightGrams: change.weightGrams } : {}),
      ...(change.active !== undefined ? { active: change.active } : {}),
      ...(pattern ? { sku: skuFromPattern(pattern, handle, variant.options, index + 1) } : {}),
    };
  });
}

/**
 * Which rows to draw (`useVirtualRows()`): the first and last row any part of which is between `top` and `bottom` (pixels from the top of the
 * list, widened by `overscan` on both sides), and the height above and below them, from each row's measured or estimated height.
 */
export function visibleRange(heights: readonly number[], top: number, bottom: number, overscan: number): { start: number; end: number; before: number; after: number } {
  const from = top - overscan;
  const to = bottom + overscan;
  let offset = 0;
  let start = heights.length;
  let before = 0;
  let end = heights.length;
  for (let i = 0; i < heights.length; i += 1) {
    const next = offset + heights[i];
    if (start === heights.length && next > from) {
      start = i;
      before = offset;
    }
    if (start !== heights.length && offset >= to) {
      end = i;
      break;
    }
    offset = next;
  }
  if (start === heights.length) return { start, end: start, before: offset, after: 0 };
  const total = heights.reduce((sum, h) => sum + h, 0);
  const drawn = heights.slice(start, end).reduce((sum, h) => sum + h, 0);
  return { start, end, before, after: total - before - drawn };
}
