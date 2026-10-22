import { countWords, fillWords } from "./admin-fill";
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

/**
 * The words `whatChanges()` writes, in English unless an admin catalogue's `design.changes` is given (D312 A7). `{name}`-style placeholders;
 * a `{ one, many }` pair is chosen by its count. `styles` names the core section styles; another style's name is made from its key.
 */
export const CHANGES_WORDS = {
  quote: "“{title}”",
  layouts: {
    header: { name: "header", standard: "the standard header" },
    footer: { name: "footer", standard: "the standard footer" },
    productLayout: { name: "product page layout", standard: "the standard product page" },
  },
  untitled: "Untitled {name}",
  layoutChanges: "The {layout} changes from {from} to {to}.",
  styleUse: { one: "{n} page uses the section style {style}", many: "{n} pages use the section style {style}" },
  styleHas: "{where}; {target} has it.",
  styleToPlain: "{where}; {target} does not have it, so those rows take its Plain style.",
  styleToElements: "{where}; {target} has neither it nor a Plain style, so those rows take its site-wide elements.",
  settings: { one: "{n} setting", many: "{n} settings" },
  pages: { one: "{n} page", many: "{n} pages" },
  own: { one: "{settings} on {pages} is your own and stays as it is.", many: "{settings} on {pages} are your own and stay as they are." },
  repeating: {
    one: "{settings} on {pages} only repeats your current theme, so it keeps today's look rather than {target}'s. Use “Let pages follow the theme” first to change that.",
    many: "{settings} on {pages} only repeat your current theme, so they keep today's look rather than {target}'s. Use “Let pages follow the theme” first to change that.",
  },
  fonts: { one: "{target} uses a font your current theme does not: {fonts}.", many: "{target} uses fonts your current theme does not: {fonts}." },
  cssOwn: "Your current CSS stays with {live}; {target} has its own.",
  cssNone: "Your current CSS stays with {live}; {target} has none.",
  cssFit: "CSS written for one layout may not fit another: look at the preview before you switch.",
  styles: {} as Record<string, string>,
};

type Pair = { one: string; many: string };
export type ChangesWords = {
  quote: string;
  layouts: Record<LayoutKind, { name: string; standard: string }>;
  untitled: string;
  layoutChanges: string;
  styleUse: Pair;
  styleHas: string;
  styleToPlain: string;
  styleToElements: string;
  settings: Pair;
  pages: Pair;
  own: Pair;
  repeating: Pair;
  fonts: Pair;
  cssOwn: string;
  cssNone: string;
  cssFit: string;
  styles: Record<string, string>;
};

const fill = fillWords;
const count = countWords;

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

function layoutName(kind: LayoutKind, layout: { id: string | null; title: string | null }, w: ChangesWords): string {
  return layout.id ? fill(w.quote, { title: layout.title || fill(w.untitled, { name: w.layouts[kind].name }) }) : w.layouts[kind].standard;
}

/** What switching from `live` to `target` does to `pages`, in the words given (English unless an admin catalogue's are). */
export function whatChanges(live: LookFacts, target: LookFacts, pages: PageFacts[], w: ChangesWords = CHANGES_WORDS): WhatChanges {
  const quoted = (title: string) => fill(w.quote, { title });
  const layouts = LAYOUT_KINDS.filter((kind) => (live.layouts[kind].id ?? null) !== (target.layouts[kind].id ?? null)).map((kind) => ({
    kind,
    from: layoutName(kind, live.layouts[kind], w),
    to: layoutName(kind, target.layouts[kind], w),
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
    .map(([name, count]) => ({ name, label: w.styles[name] ?? sectionStyleLabel(name), pages: count, has: has(name), plain: has("plain") }));

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
  for (const layout of layouts) lines.push(fill(w.layoutChanges, { layout: w.layouts[layout.kind].name, from: layout.from, to: layout.to }));
  const target_ = quoted(target.title);
  for (const style of styles) {
    const where = count(style.pages, w.styleUse, { style: style.label });
    lines.push(fill(style.has ? w.styleHas : style.plain ? w.styleToPlain : w.styleToElements, { where, target: target_ }));
  }
  if (own.settings > 0) {
    lines.push(count(own.settings, w.own, { settings: count(own.settings, w.settings), pages: count(own.pages, w.pages) }));
  }
  if (repeating.settings > 0) {
    lines.push(count(repeating.settings, w.repeating, { settings: count(repeating.settings, w.settings), pages: count(repeating.pages, w.pages), target: target_ }));
  }
  if (fontsAdded.length > 0) lines.push(count(fontsAdded.length, w.fonts, { target: target_, fonts: fontsAdded.join(", ") }));
  if (css.live && live.css !== target.css) lines.push(fill(css.target ? w.cssOwn : w.cssNone, { live: quoted(live.title), target: target_ }));
  if (css.live || css.target) lines.push(w.cssFit);
  return { layouts, styles, own, repeating, fontsAdded, css, lines };
}
