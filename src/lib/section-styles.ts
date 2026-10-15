import type { ThemeElement } from "./page-content";
import type { ThemeElementKey, ThemeElements } from "./theme-elements";

/**
 * Section styles (D242, `docs/theme-phase-2.md` step 1): a named set of theme elements (D182) for the rows that name it. A row naming
 * `hero` takes the theme's `hero` elements laid over the theme's own, and its own settings win over both. Every Kaizena theme defines the
 * core names, so a switch between them always lands; a theme may add its own. A name the live theme does not have falls back to its
 * `plain`, then to the theme's own elements. Pure and free of zod (the builder and the site both read it).
 */

export const CORE_SECTION_STYLES = ["plain", "hero", "feature", "muted", "contrast", "quote"] as const;
export type CoreSectionStyle = (typeof CORE_SECTION_STYLES)[number];

export const CORE_SECTION_LABELS: Record<CoreSectionStyle, { name: string; hint: string }> = {
  plain: { name: "Plain", hint: "The usual row. Rows naming a style the theme does not have look like this." },
  hero: { name: "Hero", hint: "The large first section of a page: a big heading over a picture or a strong colour." },
  feature: { name: "Feature", hint: "A section that presents something: a few columns with a heading and a short text each." },
  muted: { name: "Muted", hint: "A quieter section on a soft background, to set it apart from the ones around it." },
  contrast: { name: "Contrast", hint: "A section that stands out: dark on light themes, light on dark ones." },
  quote: { name: "Quote", hint: "A testimonial or a saying, with larger text." },
};

/** A theme's own style names: lowercase letters, digits and hyphens, starting with a letter. */
export const SECTION_STYLE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** At most this many styles in a theme, the core ones included. */
export const SECTION_STYLES_MAX = 12;

/** A theme's section styles: each a set of elements. */
export type SectionStyles = Record<string, ThemeElements>;

export const isCoreSectionStyle = (name: string): name is CoreSectionStyle => (CORE_SECTION_STYLES as readonly string[]).includes(name);

/** How a style is named in the builder: a core style by its label, a theme's own by its name with the first letter raised. */
export const sectionStyleLabel = (name: string): string =>
  isCoreSectionStyle(name) ? CORE_SECTION_LABELS[name].name : name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/** The styles a row can choose in a theme: the core ones first, then the theme's own, in the order it keeps them. */
export function sectionStyleChoices(sections: SectionStyles | undefined): string[] {
  const own = Object.keys(sections ?? {}).filter((name) => !isCoreSectionStyle(name));
  return [...CORE_SECTION_STYLES, ...own];
}

/**
 * The elements a row naming `name` is drawn with: the style's elements laid over the theme's own (each key the style says something of),
 * `plain` standing in for a style the theme does not have. `layer` is `layerUnder()`, passed in so this module stays light.
 */
export function sectionElements(
  elements: ThemeElements | undefined,
  sections: SectionStyles | undefined,
  name: string | undefined,
  layer: (top: ThemeElement, under: ThemeElement | undefined) => ThemeElement,
): ThemeElements | undefined {
  if (!name || !sections) return elements;
  const style = sections[name] ?? sections.plain;
  if (!style) return elements;
  const out: ThemeElements = { ...(elements ?? {}) };
  for (const key of Object.keys(style) as ThemeElementKey[]) {
    const own = style[key];
    if (own) out[key] = layer(own, elements?.[key]);
  }
  return out;
}
