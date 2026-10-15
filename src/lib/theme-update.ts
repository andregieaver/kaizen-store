import type { DesignLayout, DesignLayoutKind, DesignSnapshot } from "./design-presets";
import { canonicalJson } from "./lifecycle";
import { CORE_SECTION_STYLES, sectionStyleLabel } from "./section-styles";

/**
 * Updates of an installed theme (D245, `docs/theme-phase-2.md` step 4, the plan's 4.6). Pure. A theme's version never changes; an install
 * keeps what was placed when it was applied or last updated (`Placed`: the settings and CSS written, each layout page with a fingerprint of
 * its content), so the owner's own changes are what differs from that. An update lays the new version under them again: a setting the owner
 * left as placed takes the new version's, one they changed stays theirs (`mergeSettings()`); the same for the CSS (`cssFate()`); a layout page
 * they have not touched is replaced by the new version's, one they edited stays and the new one is offered beside it (`layoutFate()`).
 */

/** What an install had placed in a store, to tell the owner's changes from the theme's. */
export type Placed = {
  settings: unknown;
  css: string;
  layouts: Record<DesignLayoutKind, { id: string; hash: string } | null>;
};

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type SettingsMerge = {
  settings: unknown;
  /** Paths of the settings the owner changed, carried into the new version. */
  own: string[];
  /** Of those, the ones the new version changed too: the owner's stays, the version's is not taken. */
  kept: string[];
};

/**
 * Three-way merge of theme settings: `base` is what was placed, `mine` what the store has now, `theirs` the new version's. Objects are merged
 * key by key; anything else (a value, a list) is one setting. Where the owner left a setting as placed, the version's wins; where the version
 * left it, the owner's stays; where both changed it, the owner's stays (and is reported in `kept`).
 */
export function mergeSettings(base: unknown, mine: unknown, theirs: unknown): SettingsMerge {
  const own: string[] = [];
  const kept: string[] = [];
  const walk = (b: unknown, m: unknown, t: unknown, path: string): unknown => {
    if (same(m, b)) return t;
    if (isPlain(b) && isPlain(m) && isPlain(t)) {
      const out: Record<string, unknown> = {};
      for (const key of [...new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b)])].sort()) {
        const value = walk(b[key], m[key], t[key], path ? `${path}.${key}` : key);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    own.push(path || "(all)");
    if (!same(t, b)) kept.push(path || "(all)");
    return m;
  };
  const settings = walk(base, mine, theirs, "");
  return { settings, own, kept };
}

/** The site's CSS after an update: the version's while the owner left it as placed, else the owner's. */
export function cssFate(base: string, mine: string, theirs: string): { css: string; own: boolean; kept: boolean } {
  if (mine === base) return { css: theirs, own: false, kept: false };
  return { css: mine, own: true, kept: theirs !== base };
}

export type LayoutFate =
  /** Untouched by the owner: the new version's page takes its place. */
  | { kind: "replace" }
  /** Untouched, and the new version has none: the standard one is drawn. */
  | { kind: "standard" }
  /** The owner's own (edited, or chosen by them): kept; `offer` when the new version has one, made as a draft beside it. */
  | { kind: "keep"; offer: boolean }
  /** Nothing before and nothing now. */
  | { kind: "none" };

/**
 * What an update does to one layout: `placed` is what the install placed (null for an install from before updates were kept), `current` the
 * page the install shows now and its fingerprint, `next` whether the new version has one.
 */
export function layoutFate(placed: { id: string; hash: string } | null, current: { id: string; hash: string } | null, next: boolean): LayoutFate {
  const untouched = placed !== null && current !== null && placed.id === current.id && placed.hash === current.hash;
  if (current === null && placed === null) return next ? { kind: "replace" } : { kind: "none" };
  if (untouched) return next ? { kind: "replace" } : { kind: "standard" };
  return { kind: "keep", offer: next };
}

/** A layout page's content as its fingerprint is taken: its rows and CSS, nothing the store fills in later (title, address). */
export const layoutFingerprintSource = (content: { rows: unknown; css?: string }): string => canonicalJson({ rows: content.rows, css: content.css ?? "" });

const AREA_WORDS: Record<string, string> = {
  light: "colours",
  dark: "colours for dark mode",
  fonts: "fonts",
  headings: "headings",
  buttons: "buttons",
  corners: "corners",
  layout: "page width and header",
  productCards: "product cards",
  breakpoints: "screen sizes",
  elements: "text and spacing",
  sectionStyles: "section styles",
  hover: "hover effects",
  mode: "light and dark",
  visitorSwitch: "the light and dark switch",
};

const LAYOUT_WORDS: Record<DesignLayoutKind, string> = { header: "header", footer: "footer", productLayout: "product page" };

const layoutKey = (layout: DesignLayout | null) => (layout ? canonicalJson({ rows: layout.rows, css: layout.css, overlay: layout.overlay ?? null }) : null);

/** *What's new* in a version, from facts: the theme's own note first, then what changed in its settings, section styles, layouts and CSS. */
export function whatsNew(previous: DesignSnapshot, next: DesignSnapshot, notes: string | null): string[] {
  const lines: string[] = [];
  if (notes && notes.trim()) lines.push(notes.trim());
  const before = previous.theme.settings as unknown as Record<string, unknown>;
  const after = next.theme.settings as unknown as Record<string, unknown>;
  const areas = [...new Set(Object.keys({ ...before, ...after }).filter((key) => key !== "sectionStyles" && key !== "library" && !same(before[key], after[key])))]
    .map((key) => AREA_WORDS[key] ?? key)
    .filter((word, i, all) => all.indexOf(word) === i);
  if (areas.length > 0) lines.push(`New ${areas.join(", ")}.`);
  const styles = (s: Record<string, unknown>) => Object.keys((s.sectionStyles as Record<string, unknown>) ?? {});
  const added = styles(after).filter((name) => !styles(before).includes(name));
  const removed = styles(before).filter((name) => !styles(after).includes(name));
  const changed = styles(after).filter((name) => styles(before).includes(name) && !same((before.sectionStyles as Record<string, unknown>)[name], (after.sectionStyles as Record<string, unknown>)[name]));
  if (added.length > 0) lines.push(`New section ${added.length === 1 ? "style" : "styles"}: ${added.map(sectionStyleLabel).join(", ")}.`);
  if (changed.length > 0) lines.push(`Changed section ${changed.length === 1 ? "style" : "styles"}: ${changed.map(sectionStyleLabel).join(", ")}.`);
  if (removed.length > 0) lines.push(`No longer has the section ${removed.length === 1 ? "style" : "styles"} ${removed.map(sectionStyleLabel).join(", ")}: rows naming ${removed.length === 1 ? "it" : "them"} take its Plain style.`);
  for (const kind of ["header", "footer", "productLayout"] as const) {
    const was = layoutKey(previous[kind]);
    const now = layoutKey(next[kind]);
    if (was === now) continue;
    if (!now) lines.push(`No ${LAYOUT_WORDS[kind]} of its own any more: the standard one is used.`);
    else lines.push(was ? `A new ${LAYOUT_WORDS[kind]}.` : `Its own ${LAYOUT_WORDS[kind]}.`);
  }
  if (previous.css !== next.css) lines.push("Changed CSS.");
  return lines;
}

/** Core section styles (D242) the previous version had and the next one does not: an update may never take one away. */
export function coreStylesRemoved(previous: { sectionStyles?: Record<string, unknown> } | null, next: { sectionStyles?: Record<string, unknown> }): string[] {
  if (!previous) return [];
  return CORE_SECTION_STYLES.filter((name) => previous.sectionStyles?.[name] !== undefined && next.sectionStyles?.[name] === undefined);
}
