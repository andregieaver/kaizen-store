/**
 * The text colours an owner's own CSS gives class names (wave 11 unit K, D390, PSI ACC-04), for the page checker: a page's CSS and the
 * site's (D100) can colour `.green-text` or `.super-heading.dark-color`, which a block, a column, a row or a `<span class>` in a text
 * (D191's inline markup) then wears, and `pageIssues()` read only the colours set in the builder. Kaizena Flow's own front page shipped
 * at 2.6 to 3.8:1 that way. Only what can be read for certain is read: a rule whose selector is one element's classes (`.a`, `.a.b`),
 * a `color` written as `#rgb` or `#rrggbb`, the last such rule winning as in CSS; descendants, states, ids, elements and `var()` are left
 * out (never a guess). Pure, no zod: the builder reads it.
 */

export type ClassColour = { classes: readonly string[]; color: string };

const RULE = /([^{}]+)\{([^{}]*)\}/g;
const COMPOUND = /^(?:\.[A-Za-z_][\w-]*)+$/;
const COLOR = /(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*(?:!important\s*)?(?:;|$)/gi;

const full = (hex: string): string =>
  hex.length === 4 ? `#${[1, 2, 3].map((i) => hex[i] + hex[i]).join("")}`.toLowerCase() : hex.toLowerCase();

/** Every rule of the CSS that colours text by classes alone, in the order written. */
export function classColours(css: string): ClassColour[] {
  const found: ClassColour[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of text.matchAll(RULE)) {
    let color: string | null = null;
    for (const match of body.matchAll(COLOR)) color = full(match[1]);
    if (!color) continue;
    for (const raw of selectors.split(",")) {
      const selector = raw.trim();
      if (!COMPOUND.test(selector)) continue;
      found.push({ classes: selector.slice(1).split("."), color });
    }
  }
  return found;
}

/** The colour the rules give an element with these classes (the last rule all of whose classes it has), else none. */
export function colourOfClasses(classes: Iterable<string>, rules: readonly ClassColour[]): string | null {
  const has = new Set(classes);
  if (has.size === 0) return null;
  let color: string | null = null;
  for (const rule of rules) if (rule.classes.every((name) => has.has(name))) color = rule.color;
  return color;
}

/** The class names of a `class` attribute or a part's `className`. */
export const classNames = (value: string | undefined | null): string[] => (value ?? "").split(/\s+/).filter(Boolean);
