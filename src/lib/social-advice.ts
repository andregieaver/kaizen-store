/**
 * The social media adviser's answer (D870 S1.4, `docs/social-manager.md` 4): three verdicts on how the store stands, recommendations tied
 * to its goals, and a two-week content calendar, written by the store's AI from the facts (`socialFacts()`) and nothing else. What the
 * adviser must answer and how an answer is read and checked. Pure.
 *
 * The model's words carry no figure: every number the owner sees beside them is code's, from the facts. A sentence with a digit, a claim the
 * filter finds or a word the brand avoids is dropped; a recommendation or a calendar day may only name a product the facts offered and a day
 * of the next two weeks; anything else in the answer is left out, and an answer without three verdicts is refused.
 */

import { findAvoided } from "./brand";
import { findClaims } from "./claims";
import type { SocialFacts } from "./social-facts";
import { POST_CHANNELS, type PostChannel } from "./post-links";

export const VERDICTS = 3;
export const RECOMMENDATIONS_MAX = 5;
export const CALENDAR_DAYS = 14;
export const CALENDAR_MAX = 10;
export const VERDICT_MAX = 160;
export const TITLE_MAX = 80;
export const WHY_MAX = 280;
export const IDEA_MAX = 200;

/** What a recommendation asks the owner to do: write posts (about a product, or a topic), or fix what keeps the adviser blind. */
export const ACTION_KINDS = ["write", "connect_instagram", "count_visits", "habit"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Recommendation = {
  title: string;
  why: string;
  kind: ActionKind;
  /** For `write`: the product it is about (one the facts offered), else a topic in a few words. */
  productId: string | null;
  topic: string;
  channels: PostChannel[];
};

export type CalendarSlot = { day: string; channel: PostChannel; productId: string | null; idea: string };

export type Advice = { verdicts: string[]; recommendations: Recommendation[]; calendar: CalendarSlot[] };

/** The answer's shape, for the adviser. */
export const ADVICE_SHAPE = [
  `Answer only with JSON: {"verdicts": string[] (exactly ${VERDICTS}, each one plain sentence under ${VERDICT_MAX} characters),`,
  `"recommendations": [{"title": string (under ${TITLE_MAX} characters), "why": string (under ${WHY_MAX} characters, naming the goal or fact it serves),`,
  `"kind": one of ${ACTION_KINDS.map((k) => `"${k}"`).join(", ")}, "productId": string or null (only an id from the facts' push or newProducts),`,
  `"topic": string (a few words, for a post with no product, else empty), "channels": string[] (of ${POST_CHANNELS.join(", ")})}] (at most ${RECOMMENDATIONS_MAX}, most important first),`,
  `"calendar": [{"day": "YYYY-MM-DD" (within the ${CALENDAR_DAYS} days from today), "channel": string, "productId": string or null, "idea": string (under ${IDEA_MAX} characters)}] (at most ${CALENDAR_MAX})}.`,
].join(" ");

/** The rules of the adviser's words, beside the safety rules every prompt carries. */
export const ADVISER_RULES = [
  "Never write a number, a price, an amount, a percentage or a date in your words: the owner sees every figure from the facts beside what you say.",
  "Never name a product, an offer or a fact you were not given. If the facts cannot tell something (a figure is null, Instagram is not connected, visits are not counted), say what to do about it instead of guessing.",
  "No urgency or scarcity, no best or lowest price claims, no environmental claims.",
].join(" ");

/** A sentence of the adviser's as kept: tidied, under `max`, with no digit, no claim and no avoided word; null otherwise. */
export function checkedWords(raw: unknown, max: number, avoid: readonly string[] = []): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /\d/.test(text)) return null;
  if (findClaims(text).length > 0 || findAvoided(text, avoid).length > 0) return null;
  return text;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The adviser's answer as kept, or null when it is no JSON or has fewer than three good verdicts. `today` is the store's day; the calendar
 * keeps only days from today to `CALENDAR_DAYS` - 1 after it, in order.
 */
export function parseAdvice(answer: string, facts: SocialFacts, today: string, avoid: readonly string[] = []): Advice | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const verdicts = (Array.isArray(data.verdicts) ? data.verdicts : []).map((v) => checkedWords(v, VERDICT_MAX, avoid)).filter((v): v is string => v !== null);
  if (verdicts.length < VERDICTS) return null;
  const offered = new Set([...facts.push.map((p) => p.id), ...facts.newProducts.map((p) => p.id)]);
  const product = (raw: unknown) => (typeof raw === "string" && offered.has(raw) ? raw : null);
  const channels = (raw: unknown) => (Array.isArray(raw) ? POST_CHANNELS.filter((c) => raw.includes(c)) : []);

  const recommendations: Recommendation[] = [];
  for (const raw of Array.isArray(data.recommendations) ? (data.recommendations as Record<string, unknown>[]) : []) {
    if (recommendations.length >= RECOMMENDATIONS_MAX) break;
    const title = checkedWords(raw?.title, TITLE_MAX, avoid);
    const why = checkedWords(raw?.why, WHY_MAX, avoid);
    const kind = ACTION_KINDS.find((k) => k === raw?.kind);
    if (!title || !why || !kind) continue;
    const productId = kind === "write" ? product(raw.productId) : null;
    const topic = kind === "write" && !productId ? (checkedWords(raw.topic, 120, avoid) ?? "") : "";
    const picked = channels(raw.channels);
    // A post needs a subject and a channel to be written; without them the recommendation is advice only.
    if (kind === "write" && ((!productId && topic.length < 5) || picked.length === 0)) continue;
    recommendations.push({ title, why, kind, productId, topic, channels: kind === "write" ? picked : [] });
  }

  const last = addDays(today, CALENDAR_DAYS - 1);
  const calendar: CalendarSlot[] = [];
  for (const raw of Array.isArray(data.calendar) ? (data.calendar as Record<string, unknown>[]) : []) {
    if (calendar.length >= CALENDAR_MAX) break;
    const day = typeof raw?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) && raw.day >= today && raw.day <= last ? raw.day : null;
    const channel = POST_CHANNELS.find((c) => c === raw?.channel);
    const idea = checkedWords(raw?.idea, IDEA_MAX, avoid);
    if (!day || !channel || !idea) continue;
    calendar.push({ day, channel, productId: product(raw.productId), idea });
  }
  calendar.sort((a, b) => a.day.localeCompare(b.day) || POST_CHANNELS.indexOf(a.channel) - POST_CHANNELS.indexOf(b.channel));
  return { verdicts: verdicts.slice(0, VERDICTS), recommendations, calendar };
}

/** The first recommendation that writes posts: what Homer's one button does. */
export const mainRecommendation = (advice: Advice): Recommendation | null => advice.recommendations.find((r) => r.kind === "write") ?? null;
