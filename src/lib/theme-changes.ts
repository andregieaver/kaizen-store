import type { PageRow } from "./page-content";
import { sectionStyleLabel, type SectionStyles } from "./section-styles";
import { detachThemeValues } from "./theme-detach";
import type { ThemeElements } from "./theme-elements";

/**
 * *What changes* (D244, `docs/theme-phase-2.md` step 3): what switching from the live theme to an installed one does to the store's own pages,
 * written in code from facts, before the owner switches. Pure. It never guesses at colours or taste (the preview shows those): it says which
 * layouts change, which section styles the pages use and whether the other theme has them, how many settings are the owner's own and stay,
 * how many still repeat the live theme and so will not follow, which fonts come in, and where owner CSS is involved.
 */

export const LAYOUT_KINDS = ["header", "footer", "productLayout"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

const LAYOUT_WORDS: Record<LayoutKind, { name: string; standard: string }> = {
  header: { name: "header", standard: "the standard header" },
  footer: { name: "footer", standard: "the standard footer" },
  productLayout: { name: "product page layout", standard: "the standard product page" },
};

/** One look, as the summary needs it: the theme's layers, its fonts, its CSS and its layouts' names (null: the standard one). */
export type LookFacts = {
  title: string;
  elements: ThemeElements | undefined;
  sections: SectionStyles | undefined;
  fonts: string[];
  css: string;
  layouts: Record<LayoutKind, { id: string | null; title: string | null }>;
};

/** A page or article of the store as it is shown (published, else its draft). */
export type PageFacts = { title: string; rows: PageRow[] };

export type StyleUse = { name: string; label: string; pages: number; has: boolean; plain: boolean };

export type WhatChanges = {
  layouts: { kind: LayoutKind; from: string; to: string }[];
  styles: StyleUse[];
  /** Settings that differ from the other theme: the owner's own, kept as they are. */
  own: { settings: number; pages: number };
  /** Settings that only repeat the live theme: still written in, so they will look as now rather than as the other theme says. */
  repeating: { settings: number; pages: number };
  fontsAdded: string[];
  css: { live: boolean; target: boolean };
  /** The summary as sentences, in the order shown. */
  lines: string[];
};

const quoted = (title: string) => `“${title}”`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function layoutName(kind: LayoutKind, layout: { id: string | null; title: string | null }): string {
  return layout.id ? quoted(layout.title || `Untitled ${LAYOUT_WORDS[kind].name}`) : LAYOUT_WORDS[kind].standard;
}

/** What switching from `live` to `target` does to `pages`. */
export function whatChanges(live: LookFacts, target: LookFacts, pages: PageFacts[]): WhatChanges {
  const layouts = LAYOUT_KINDS.filter((kind) => (live.layouts[kind].id ?? null) !== (target.layouts[kind].id ?? null)).map((kind) => ({
    kind,
    from: layoutName(kind, live.layouts[kind]),
    to: layoutName(kind, target.layouts[kind]),
  }));

  // The section styles rows name (D242), counted by page.
  const used = new Map<string, number>();
  for (const page of pages) {
    const names = new Set(page.rows.map((row) => row.sectionStyle).filter((name): name is string => typeof name === "string" && name.length > 0));
    for (const name of names) used.set(name, (used.get(name) ?? 0) + 1);
  }
  const has = (name: string) => Boolean(target.sections?.[name]);
  const styles: StyleUse[] = [...used.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, label: sectionStyleLabel(name), pages: count, has: has(name), plain: has("plain") }));

  const own = { settings: 0, pages: 0 };
  const repeating = { settings: 0, pages: 0 };
  for (const page of pages) {
    const kept = detachThemeValues(page.rows, target.elements, target.sections).own;
    if (kept > 0) {
      own.settings += kept;
      own.pages += 1;
    }
    const stale = detachThemeValues(page.rows, live.elements, live.sections).followed;
    if (stale > 0) {
      repeating.settings += stale;
      repeating.pages += 1;
    }
  }

  const fontsAdded = target.fonts.filter((family) => !live.fonts.includes(family));
  const css = { live: live.css.trim().length > 0, target: target.css.trim().length > 0 };

  const lines: string[] = [];
  for (const layout of layouts) lines.push(`The ${LAYOUT_WORDS[layout.kind].name} changes from ${layout.from} to ${layout.to}.`);
  for (const style of styles) {
    const where = `${plural(style.pages, "page uses", "pages use")} the section style ${style.label}`;
    if (style.has) lines.push(`${where}; ${quoted(target.title)} has it.`);
    else if (style.plain) lines.push(`${where}; ${quoted(target.title)} does not have it, so those rows take its Plain style.`);
    else lines.push(`${where}; ${quoted(target.title)} has neither it nor a Plain style, so those rows take its site-wide elements.`);
  }
  if (own.settings > 0) {
    lines.push(`${plural(own.settings, "setting", "settings")} on ${plural(own.pages, "page", "pages")} ${own.settings === 1 ? "is" : "are"} your own and stay as ${own.settings === 1 ? "it is" : "they are"}.`);
  }
  if (repeating.settings > 0) {
    lines.push(
      `${plural(repeating.settings, "setting", "settings")} on ${plural(repeating.pages, "page", "pages")} only repeat${repeating.settings === 1 ? "s" : ""} your current theme, so ${repeating.settings === 1 ? "it keeps" : "they keep"} today's look rather than ${quoted(target.title)}'s. Use “Let pages follow the theme” first to change that.`,
    );
  }
  if (fontsAdded.length > 0) lines.push(`${quoted(target.title)} uses ${fontsAdded.length === 1 ? "a font" : "fonts"} your current theme does not: ${fontsAdded.join(", ")}.`);
  if (css.live && live.css !== target.css) lines.push(`Your current CSS stays with ${quoted(live.title)}; ${quoted(target.title)} ${css.target ? "has its own" : "has none"}.`);
  if (css.live || css.target) lines.push("CSS written for one layout may not fit another: look at the preview before you switch.");
  return { layouts, styles, own, repeating, fontsAdded, css, lines };
}
