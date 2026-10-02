import { CSS_MAX, allowedCssUrl, cssProblem } from "./custom-css";

/**
 * The look of a copied page, kept as data (D150): one rule per part (a row, column or block, by its id) and per place
 * inside it (`suffix`), each with its declarations for computers and, where phones differ, for phones. The converter
 * writes them from the original's styles, the improving passes change them, and `renderStyles()` turns them into the
 * page's own CSS (D100), checked again by `cssProblem()` when the page is saved. Nothing a model or a page says becomes
 * CSS except through `cleanDecl()`: only these properties, and values made of numbers, units, colours and keywords.
 */

export type Decl = Record<string, string>;
/** `suffix` is a selector after the part's id: empty for the part, or one of what the converter makes (` a`, ` img`, …). */
export type StyleRule = { id: string; suffix: string; desktop: Decl; mobile: Decl };
export type StyleModel = { rules: StyleRule[] };

/** The phones' query: the builder's own breakpoint (`md`, 768 px) is where columns stop stacking. */
export const PHONE_QUERY = "(max-width: 767.98px)";

/** The properties a copy may set, with the kind of value each takes. */
const PROPS: Record<string, "length" | "color" | "number" | "keyword" | "text" | "shorthand" | "background"> = {
  "margin-top": "length",
  "margin-right": "length",
  "margin-bottom": "length",
  "margin-left": "length",
  margin: "shorthand",
  "padding-top": "length",
  "padding-right": "length",
  "padding-bottom": "length",
  "padding-left": "length",
  padding: "shorthand",
  width: "length",
  "max-width": "length",
  "min-width": "length",
  height: "length",
  "min-height": "length",
  "max-height": "length",
  gap: "shorthand",
  "column-gap": "length",
  "row-gap": "length",
  "grid-template-columns": "text",
  "aspect-ratio": "text",
  "font-size": "length",
  "font-weight": "number",
  "font-style": "keyword",
  "font-family": "text",
  "line-height": "length",
  "letter-spacing": "length",
  "text-align": "keyword",
  "text-transform": "keyword",
  "text-decoration": "text",
  "text-decoration-line": "keyword",
  "text-shadow": "text",
  "white-space": "keyword",
  color: "color",
  "background-color": "color",
  background: "background",
  "background-image": "background",
  "background-size": "text",
  "background-position": "text",
  "background-repeat": "keyword",
  "border-top": "text",
  "border-right": "text",
  "border-bottom": "text",
  "border-left": "text",
  "border-radius": "shorthand",
  "box-shadow": "text",
  opacity: "number",
  display: "keyword",
  "flex-direction": "keyword",
  "flex-wrap": "keyword",
  "justify-content": "keyword",
  "align-items": "keyword",
  "object-fit": "keyword",
  "object-position": "text",
  overflow: "keyword",
  "list-style-type": "keyword",
  "list-style-position": "keyword",
  filter: "text",
  "z-index": "number",
};

export const COPY_PROPERTIES = Object.keys(PROPS);

const KEYWORD = /^[a-z][a-z-]{0,40}$/;
const LENGTH = /^(?:-?\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh|svh|ch)?|auto|normal|none|0|calc\([\d\s.+\-*/%a-z()]{1,60}\)|min\([\d\s.,%a-z()]{1,60}\)|max\([\d\s.,%a-z()]{1,60}\)|clamp\([\d\s.,%a-z()]{1,80}\))$/i;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)|transparent|currentcolor|inherit)$/i;
/** Text values: numbers, units, colours, keywords, commas, quotes and brackets, nothing that can open a rule or load a file. */
const TEXT = /^[\w\s.,%#()'"/+*:-]{1,300}$/;

/** A value of a property that may be set, written safely; null if it is not one a copy may use. */
export function cleanDecl(property: string, raw: string): string | null {
  const kind = PROPS[property];
  if (!kind) return null;
  const value = raw.trim().replace(/\s*!important$/i, "");
  if (value === "" || value.length > 600 || /[;{}<>\\@]/.test(value)) return null;
  switch (kind) {
    case "length":
      return LENGTH.test(value) ? value : null;
    case "number":
      return NUMBER.test(value) ? value : null;
    case "keyword":
      return KEYWORD.test(value) ? value : null;
    case "color":
      return COLOR.test(value) ? value : null;
    case "shorthand":
      return value.split(/\s+/).length <= 4 && value.split(/\s+/).every((part) => LENGTH.test(part)) ? value : null;
    case "text":
      return TEXT.test(value) && !/url\(|expression|javascript|image-set|@import/i.test(value) ? value : null;
    case "background": {
      // Pictures only by their address in the media library, in url(), and gradients; checked here and by `cssProblem()`.
      if (/expression|javascript|image-set|@import|[<]/i.test(value)) return null;
      for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) {
        if (!allowedCssUrl(match[1] ?? match[2] ?? match[3] ?? "")) return null;
      }
      const withoutUrls = value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/g, "x");
      return /^[\w\s.,%#()'"/+*:-]{1,600}$/.test(withoutUrls) ? value : null;
    }
  }
}

/** A declaration set with only what `cleanDecl()` accepts. */
export function cleanDecls(decl: Record<string, string>): Decl {
  const out: Decl = {};
  for (const [property, value] of Object.entries(decl)) {
    const cleaned = cleanDecl(property, value);
    if (cleaned !== null) out[property] = cleaned;
  }
  return out;
}

/** What a selector suffix may hold: the places the converter makes (descendant and child combinators, tags, `:is()`, `:nth-child()`, classes of the page's own blocks). */
const SUFFIX = /^(?:\s*>?\s*(?:\*|[a-z][a-z0-9]*|:last-child|:first-child|:nth-child\(\d{1,3}\)|\.rich-text|:is\([a-z0-9,]{1,60}\)|\+\s*li))*$/;
export const suffixOk = (suffix: string): boolean => suffix.length <= 120 && SUFFIX.test(suffix);

/** A row's padding is drawn inline (20 px until it is set), which a rule beats only by being important. */
const rule = (selector: string, decl: Decl, part = false): string => {
  const body = Object.entries(decl)
    .map(([property, value]) => `${property}:${value}${part && property.startsWith("padding-") ? "!important" : ""}`)
    .join(";");
  return body === "" ? "" : `${selector}{${body}}`;
};

/** The rule for one part, found by its id and suffix; made empty if there is none. */
export function ruleOf(model: StyleModel, id: string, suffix: string): StyleRule {
  let found = model.rules.find((r) => r.id === id && r.suffix === suffix);
  if (!found) {
    found = { id, suffix, desktop: {}, mobile: {} };
    model.rules.push(found);
  }
  return found;
}

const LOW_WEIGHT = ["letter-spacing", "text-shadow", "filter", "object-position"];

/**
 * The model as CSS: the shared rule first, then each part's, then the phones' in one media query. If it is longer than the
 * page may hold (`CSS_MAX`), the declarations of least weight go first, then the phones' rules, then the last parts;
 * `trimmed` says what was given up.
 */
export function renderStyles(model: StyleModel, shared: string): { css: string; trimmed: string | null } {
  const selectorOf = (r: StyleRule) => `#${r.id}${r.suffix}`;
  const build = (rules: StyleRule[], withMobile: boolean, skip: string[]) => {
    const pick = (decl: Decl) => Object.fromEntries(Object.entries(decl).filter(([property]) => !skip.includes(property)));
    const desktop = rules.map((r) => rule(selectorOf(r), pick(r.desktop), r.suffix === "")).filter(Boolean).join("\n");
    const phones = withMobile ? rules.map((r) => rule(selectorOf(r), pick(r.mobile), r.suffix === "")).filter(Boolean).join("\n") : "";
    return [shared, desktop, phones ? `@media ${PHONE_QUERY}{\n${phones}\n}` : ""].filter(Boolean).join("\n");
  };
  const attempts: { mobile: boolean; skip: string[]; note: string | null }[] = [
    { mobile: true, skip: [], note: null },
    { mobile: true, skip: LOW_WEIGHT, note: "The page's CSS was close to its limit, so letter spacing and shadows on text were left out." },
    { mobile: false, skip: LOW_WEIGHT, note: "The page's CSS was too long to keep the phones' layout, so the phone sizes were left out." },
  ];
  for (const attempt of attempts) {
    const css = build(model.rules, attempt.mobile, attempt.skip);
    if (css.length <= CSS_MAX) return { css, trimmed: attempt.note };
  }
  // Still too long: the last parts go, whole rules at a time.
  let rules = model.rules;
  while (rules.length > 0) {
    rules = rules.slice(0, Math.floor(rules.length * 0.9));
    const css = build(rules, false, LOW_WEIGHT);
    if (css.length <= CSS_MAX) return { css, trimmed: "The page was larger than a page's CSS may be, so the sizes of its last parts were left out." };
  }
  return { css: shared.slice(0, CSS_MAX), trimmed: "The page was larger than a page's CSS may be, so its sizes were left out." };
}

/** Whether rendered CSS may be saved (the same check the page applies). */
export const stylesProblem = (css: string): string | null => cssProblem(css);
