import { z } from "zod";

import { FRESHNESS, QUERY_MAX, SEARCH_RESULTS_MAX } from "./web-search";

/**
 * The AI's research notes and comparisons (D329, `docs/ai-autopilot.md` 13.4): the tools' inputs, the limits, and `compareOptions()`,
 * which adds up a comparison in code (integers only), so the model scores each option and says why, and never works out a total or a rank.
 */

/** A note's sources must have been searched or read by the store within this many days. */
export const SOURCE_DAYS = 30;
/** Searched and read addresses are kept this long. */
export const RESEARCH_KEEP_DAYS = 90;
/** Notes a store keeps at most. */
export const NOTES_MAX = 500;
export const FINDING_MAX = 2000;
export const NOTE_SOURCES_MAX = 20;
export const CRITERIA_MAX = 8;
export const OPTIONS_MAX = 8;
export const SCORE_MAX = 5;
export const WEIGHT_MAX = 5;

const address = z.string().trim().min(1).max(2000);

export const searchWebInput = z.object({
  query: z.string().trim().min(2).max(QUERY_MAX).describe("What to look for, as you would type it into a search engine."),
  count: z.number().int().min(1).max(SEARCH_RESULTS_MAX).default(8).describe(`How many results, at most ${SEARCH_RESULTS_MAX}.`),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "A country is two letters, such as NO or DE.")
    .optional()
    .describe("Prefer results from this country (two letters), when the question is about one market."),
  freshness: z.enum(FRESHNESS).default("any").describe("Only results from the last day, week, month or year, or any time."),
});

export const readWebPageInput = z.object({
  url: address.describe("The page's full address (https://…), usually one a search gave."),
});

export const saveResearchNoteInput = z.object({
  topic: z.string().trim().min(1).max(200).describe("What the note is about, in a few words, such as 'Demand for AI bookkeeping help in Norway'."),
  finding: z.string().trim().min(1).max(FINDING_MAX).describe("What you found, in your own words: facts with where they come from, and what they mean for the business."),
  sources: z
    .array(address)
    .min(1)
    .max(NOTE_SOURCES_MAX)
    .describe("The addresses the finding rests on: each one you searched for or read with search_web or read_web_page in the last 30 days."),
});

export const listResearchNotesInput = z.object({
  topic: z.string().trim().max(200).optional().describe("Only notes whose topic or finding has these words."),
  limit: z.number().int().min(1).max(50).default(20),
});

const criterion = z.object({
  name: z.string().trim().min(1).max(80),
  weight: z.number().int().min(1).max(WEIGHT_MAX).describe("How much it matters, 1 (a little) to 5 (most)."),
});
const option = z.object({
  name: z.string().trim().min(1).max(120),
  scores: z.record(z.string(), z.number().int().min(1).max(SCORE_MAX)).describe("A score of 1 (poor) to 5 (best) for every criterion, by its name."),
  reason: z.string().trim().max(600).default("").describe("Why it scores so, with the sources in the notes it rests on."),
});

export const compareOptionsInput = z.object({
  topic: z.string().trim().min(1).max(200).describe("What is compared, such as 'Which service to offer first'."),
  criteria: z.array(criterion).min(1).max(CRITERIA_MAX),
  options: z.array(option).min(2).max(OPTIONS_MAX),
  sources: z.array(address).max(NOTE_SOURCES_MAX).default([]).describe("Addresses searched or read in the last 30 days that the scores rest on."),
});
export type CompareOptionsInput = z.infer<typeof compareOptionsInput>;

export type ComparedOption = { name: string; total: number; max: number; percent: number; rank: number; scores: Record<string, number>; reason: string };
export type Comparison = { criteria: { name: string; weight: number }[]; options: ComparedOption[] };

/**
 * The options' weighted totals (each score times its criterion's weight), as a whole percentage of the most they could have, ranked best
 * first; equal totals share a rank. Refused, with the problem in words, when a criterion is named twice or an option lacks a score.
 */
export function compareOptions(input: Pick<CompareOptionsInput, "criteria" | "options">): { ok: true; comparison: Comparison } | { ok: false; problem: string } {
  const names = input.criteria.map((c) => c.name.trim());
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, problem: `The criterion "${name}" is named twice.` };
    seen.add(key);
  }
  const optionNames = new Set<string>();
  for (const o of input.options) {
    const key = o.name.trim().toLowerCase();
    if (optionNames.has(key)) return { ok: false, problem: `The option "${o.name}" is named twice.` };
    optionNames.add(key);
  }
  const max = input.criteria.reduce((sum, c) => sum + c.weight * SCORE_MAX, 0);
  const scored: Omit<ComparedOption, "rank">[] = [];
  for (const o of input.options) {
    const byName = new Map(Object.entries(o.scores).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const scores: Record<string, number> = {};
    let total = 0;
    for (const c of input.criteria) {
      const score = byName.get(c.name.trim().toLowerCase());
      if (score === undefined) return { ok: false, problem: `"${o.name}" has no score for "${c.name}".` };
      scores[c.name] = score;
      total += score * c.weight;
    }
    scored.push({ name: o.name, total, max, percent: Math.round((total * 100) / max), scores, reason: o.reason });
  }
  const order = [...scored].sort((a, b) => b.total - a.total);
  const options = order.map((o) => ({ ...o, rank: 1 + order.filter((other) => other.total > o.total).length }));
  return { ok: true, comparison: { criteria: input.criteria.map((c) => ({ name: c.name, weight: c.weight })), options } };
}

/** An address as compared with the sources kept: no fragment, no trailing slash, the host in lower case. */
export function normaliseSource(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
