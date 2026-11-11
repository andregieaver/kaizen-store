/**
 * Environmental claims in a store's own words (D552): the Empowering Consumers Directive (EU 2024/825, ECGT, applied from 27 September 2026)
 * bans a generic environmental claim ("eco-friendly", "bærekraftig", "klimanøytral") unless the trader can show recognised excellent
 * environmental performance, and a claim of a neutral or reduced impact that rests on offsetting emissions outright. The claims filter
 * (`src/lib/claims.ts`) already keeps them out of AI-written text; this finds them in what people wrote on the live site, so the owner can
 * rewrite them as specific, provable facts. Pure.
 *
 * A finding is a word to look at, not a verdict: a colour ("grønn") or a claim backed by a recognised label may be fine, and the owner decides.
 */

import { findClaims } from "./claims";

export type GreenFinding = { phrase: string; excerpt: string; offset: boolean };

const OFFSET = /kompens|offset|compensated/i;

/** The words around a finding, at most `width` characters each side, on one line. */
function excerptAt(text: string, index: number, length: number, width = 60): string {
  const start = Math.max(0, index - width);
  const end = Math.min(text.length, index + length + width);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** The environmental claims in a text, each with the words around it. */
export function greenClaimsIn(text: string): GreenFinding[] {
  if (!text) return [];
  return findClaims(text)
    .filter((f) => f.kind === "green")
    .map((f) => ({ phrase: f.phrase, excerpt: excerptAt(text, f.index, f.phrase.length), offset: OFFSET.test(f.phrase) }));
}

/**
 * Every piece of text in a page's content (its rows, columns and blocks, a rich text's nodes, a FAQ's answers), joined with line breaks.
 * Keys that hold no visitor text (ids, types, addresses, styles) are skipped.
 */
export function textOfContent(content: unknown): string {
  const out: string[] = [];
  const SKIP = new Set(["id", "type", "layout", "url", "href", "src", "image", "imageUrl", "style", "styles", "className", "css", "slug", "icon", "level", "anchor", "video", "poster", "color", "colour", "font"]);
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 30 || out.length > 5000) return;
    if (typeof value === "string") {
      if (!SKIP.has(key) && /\p{L}{3}/u.test(value) && !/^(https?:|\/|#|data:)/.test(value)) out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
    }
  };
  walk(content, "", 0);
  return out.join("\n");
}

/** The day the ban applied (ECGT Art. 4(1), second subparagraph). */
export const GREEN_RULE_DATE = "2026-09-27";
