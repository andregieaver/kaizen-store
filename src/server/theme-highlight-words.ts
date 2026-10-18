import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { findClaims } from "@/lib/claims";
import { PACK_TRADES } from "@/lib/content-packs";
import { parseDesignSnapshot } from "@/lib/design-presets";
import { variationsOf } from "@/lib/design-variations";
import { HIGHLIGHT_KINDS, HIGHLIGHT_NAMES, HIGHLIGHT_WORDS_MAX, readHighlightWords, type HighlightKind, type HighlightWords } from "@/lib/theme-highlights";
import { THEME_FEATURES, themeFeatures } from "@/lib/theme-store";

import { AiError, aiFor, completeText } from "./ai";
import type { Account } from "./auth";
import { themeContentOf } from "./store-starters";

/**
 * *Suggest words* for a theme's highlights (`docs/theme-showcase-phase-2.md` step 2): Kaizena Flow's text model writes a title and a line
 * for each picture from the theme's own facts only (its name and summary, what its published version includes, its presets and the trades
 * they are shown on), never a price, a comparison or a promise; every suggestion passes `findClaims()` or is left out, and none is kept
 * until a person saves it in the listing. Metered as the feature `theme_highlights`.
 */

type Row = Record<string, unknown>;

export type HighlightSuggestion = { ok: true; words: HighlightWords; leftOut: HighlightKind[] } | { ok: false; problem: string };

const SYSTEM = [
  "You write short captions for three pictures of a website theme in a theme store.",
  "Use only the facts you are given about the theme. Never mention a price, a discount, stock, speed, sales, rankings or comparisons with other themes,",
  "never promise results, and never use words like best, perfect, guaranteed, eco, green or sustainable.",
  `Each caption is a title of at most ${HIGHLIGHT_WORDS_MAX.title} characters and a line of at most ${HIGHLIGHT_WORDS_MAX.text} characters, in plain British English, no emoji.`,
  'Answer with JSON only: {"devices":{"title":"…","text":"…"},"collage":{"title":"…","text":"…"},"closeup":{"title":"…","text":"…"}}.',
].join(" ");

/** The JSON object in a model's answer (it may wrap it in words or a code fence), or null. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Superlatives and promises a theme's words never make, beyond the claims filter's own (which is about products: green claims, urgency,
 * prices, stock): a theme is never "the best", "perfect" or "guaranteed" to do anything.
 */
const PUFFERY = /\b(best|perfect(ly)?|guarantee[ds]?|fastest|ultimate|unbeatable|number one|world[- ]class|revolutionary)\b|#1\b/i;

/** The model's words, each kind kept only when its title and line pass the claims filter and make no superlative. */
export function checkedSuggestion(answer: string): { words: HighlightWords; leftOut: HighlightKind[] } {
  const read = readHighlightWords(jsonIn(answer));
  const words: HighlightWords = {};
  const leftOut: HighlightKind[] = [];
  for (const kind of HIGHLIGHT_KINDS) {
    const line = read[kind];
    if (!line) continue;
    const said = `${line.title}. ${line.text}`;
    if (findClaims(said).length > 0 || PUFFERY.test(said)) leftOut.push(kind);
    else words[kind] = line;
  }
  return { words, leftOut };
}

export async function suggestHighlightWords(admin: Account, presetId: string): Promise<HighlightSuggestion> {
  if (!admin.platformAdmin) return { ok: false, problem: "Only Kaizena Flow's platform admins write a theme's words." };
  const [row] = await readDb().execute<Row>(sql`select title, summary, snapshot from commerce.design_presets where id = ${presetId}::uuid`);
  const snapshot = row ? parseDesignSnapshot(row.snapshot) : null;
  if (!row || !snapshot) return { ok: false, problem: "The theme's published look could not be read: publish it first." };
  const connection = await aiFor(null, { feature: "theme_highlights", accountId: admin.id });
  if (!connection?.textModel) return { ok: false, problem: "No text model is set in Kaizena Flow's AI settings, so no words can be suggested. Write them yourself." };
  // Every look is shown on the theme's own content (D275): its trade's words when it is a content pack's.
  const content = await themeContentOf(presetId);
  const shownOn = content?.pack ? `sample content of a ${PACK_TRADES[content.pack].toLowerCase()} store` : "sample content";
  const looks = [String(row.title), ...variationsOf(snapshot).map((v) => v.name)];
  const facts = {
    theme: String(row.title),
    summary: String(row.summary ?? ""),
    includes: themeFeatures(snapshot).map((feature) => THEME_FEATURES[feature]),
    presets: looks.map((name) => ({ name, shownOn })),
    pictures: HIGHLIGHT_KINDS.map((kind) => ({ key: kind, shows: HIGHLIGHT_NAMES[kind] })),
  };
  try {
    const { text } = await completeText(
      connection,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `The theme's facts, as data:\n${JSON.stringify(facts, null, 1)}` },
      ],
      { maxTokens: 600, temperature: 0.4, timeoutMs: 30_000 },
    );
    const { words, leftOut } = checkedSuggestion(text);
    if (Object.keys(words).length === 0) return { ok: false, problem: "The model's words could not be used. Try again, or write them yourself." };
    return { ok: true, words, leftOut };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: `The model could not be reached (${error.message}). Write the words yourself, or try again.` };
    throw error;
  }
}
