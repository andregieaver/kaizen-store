/**
 * What the AI writes about an ended support conversation for staff (D216, `docs/support.md` 2.7): a title, a short text, an
 * outcome and topics from closed lists, and a follow-up, in English. A model's answer is used only when it parses; topics
 * outside the desk's list are dropped, and an answer with none left fails (the cron tries again). Pure and without zod.
 */

export const STORE_TOPICS = [
  "order_status",
  "delivery",
  "returns",
  "refund",
  "payment",
  "product_question",
  "availability",
  "booking",
  "subscription",
  "account",
  "discount",
  "complaint",
  "technical",
  "other",
] as const;

export const KAIZEN_TOPICS = [
  "getting_started",
  "billing",
  "payments_setup",
  "domains",
  "design",
  "products",
  "orders",
  "ai",
  "bug",
  "account",
  "other",
] as const;

export const OUTCOMES = ["resolved", "unresolved", "follow_up", "no_reply", "spam"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SUMMARY_TITLE_MAX = 80;
export const SUMMARY_TEXT_MAX = 700;
export const FOLLOW_UP_MAX = 200;
export const TOPICS_MAX = 3;
export const BRIEF_MAX = 400;

export type Summary = { title: string; text: string; outcome: Outcome; topics: string[]; followUp: string | null };

/** The topics a desk's summaries may use: a store's, or Kaizen's (`store_id` null). */
export const topicsFor = (kaizen: boolean): readonly string[] => (kaizen ? KAIZEN_TOPICS : STORE_TOPICS);

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** The first JSON object in a model's text, or null. */
export function firstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A model's summary, checked against the closed lists; null when it does not hold one. */
export function parseSummary(raw: string, topics: readonly string[]): Summary | null {
  const value = firstJsonObject(raw);
  if (!value) return null;
  const title = text(value.title, SUMMARY_TITLE_MAX);
  const body = text(value.text, SUMMARY_TEXT_MAX);
  const outcome = typeof value.outcome === "string" && (OUTCOMES as readonly string[]).includes(value.outcome) ? (value.outcome as Outcome) : null;
  const kept = Array.isArray(value.topics) ? [...new Set(value.topics.filter((t): t is string => typeof t === "string" && topics.includes(t)))].slice(0, TOPICS_MAX) : [];
  if (!title || !body || !outcome || kept.length === 0) return null;
  return { title, text: body, outcome, topics: kept, followUp: text(value.followUp, FOLLOW_UP_MAX) };
}
