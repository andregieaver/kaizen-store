/**
 * What the AI usage records and pages share (D106): the kinds of model
 * calls, what in Kaizen asks for them, and how tokens are counted when a
 * provider does not say. No secrets, no server code: the browser draws
 * reports from these too.
 */

import { formatUsd } from "./ai-cost";

export const AI_KINDS = ["text", "embedding", "transcription", "speech", "image", "live"] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const KIND_WORDS: Record<AiKind, string> = {
  text: "Text",
  embedding: "Search by meaning",
  transcription: "Speech to text",
  speech: "Text to speech",
  image: "Pictures",
  live: "Live voice calls",
};

/** What in Kaizen asked for the call, in words people read. */
export const AI_FEATURES = {
  ai_manager: "AI manager",
  chat_agent: "Chat agent",
  search: "Search",
  recommendations: "Recommendations",
  embeddings: "Catalogue vectors",
  knowledge: "Chat knowledge",
  media: "Media library",
  page_studio: "Page studio",
  page_motion: "Page motion",
  page_replica: "Page replication",
  page_translation: "Page translation",
  ui_translation: "Interface translation",
  product_writer: "Product writer",
  ai_test: "Settings tests",
  other: "Other",
} as const;
export type AiFeature = keyof typeof AI_FEATURES;

export function featureWords(feature: string): string {
  return (AI_FEATURES as Record<string, string>)[feature] ?? feature;
}

/** Whose key paid: Kaizen's (`platform`), or the owner's own (`store`). */
export const SOURCE_WORDS = { platform: "Kaizen's AI", store: "The store's own key" } as const;
export type AiSource = keyof typeof SOURCE_WORDS;

/** What one call used. */
export type UsageAmounts = {
  inputTokens: number;
  outputTokens: number;
  characters: number;
  audioBytes: number;
  audioSeconds: number;
  images: number;
};

export const NO_USAGE: UsageAmounts = { inputTokens: 0, outputTokens: 0, characters: 0, audioBytes: 0, audioSeconds: 0, images: 0 };

/** Tokens for text a provider did not count: about four characters each. */
export const estimateTokens = (characters: number) => Math.ceil(Math.max(0, characters) / 4);

/** The token counts an OpenAI-compatible answer carries (`usage`), in either of the two names providers use; null when it has none. */
export function readTokens(usage: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
  const input = n(u.prompt_tokens) ?? n(u.input_tokens);
  const output = n(u.completion_tokens) ?? n(u.output_tokens);
  const total = n(u.total_tokens);
  if (input === null && output === null) return total === null ? null : { inputTokens: total, outputTokens: 0 };
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** The reporting periods offered, in days; null is everything kept. */
export const USAGE_PERIODS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
] as const;

export function usagePeriod(id: string | undefined): (typeof USAGE_PERIODS)[number] {
  return USAGE_PERIODS.find((p) => p.id === id) ?? USAGE_PERIODS[1];
}

/** One line of a report: a combination of who, provider, model and kind, with its sums. */
export type UsageRow = {
  ownerId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  storeId: string | null;
  storeSlug: string | null;
  storeName: string | null;
  source: AiSource;
  provider: string;
  model: string;
  kind: AiKind;
  /** What in Kaizen asked (`AI_FEATURES`). */
  feature: string;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  characters: number;
  audioSeconds: number;
  images: number;
  estimatedRequests: number;
  /** What the tokens cost at the prices in force when they were used, in millionths of a US dollar (D145). */
  costMicros: number;
  /** Requests that used tokens of a model with no price (yet): their cost is not in `costMicros`. */
  unpricedRequests: number;
};

export type UsageSums = Pick<
  UsageRow,
  "requests" | "failed" | "inputTokens" | "outputTokens" | "characters" | "audioSeconds" | "images" | "estimatedRequests" | "costMicros" | "unpricedRequests"
>;

export const emptySums = (): UsageSums => ({
  requests: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  characters: 0,
  audioSeconds: 0,
  images: 0,
  estimatedRequests: 0,
  costMicros: 0,
  unpricedRequests: 0,
});

export function addSums(into: UsageSums, row: UsageSums): UsageSums {
  into.requests += row.requests;
  into.failed += row.failed;
  into.inputTokens += row.inputTokens;
  into.outputTokens += row.outputTokens;
  into.characters += row.characters;
  into.audioSeconds += row.audioSeconds;
  into.images += row.images;
  into.estimatedRequests += row.estimatedRequests;
  into.costMicros += row.costMicros;
  into.unpricedRequests += row.unpricedRequests;
  return into;
}

/** The cost as a person reads it: "$0.42", with "+" where some of the usage has no price so the real cost is higher. */
/** Whether the sums hold any use at all (a failed call that used nothing has no cost to show). */
export const usedAnything = (sums: Pick<UsageSums, "inputTokens" | "outputTokens" | "images" | "audioSeconds" | "characters">) =>
  sums.inputTokens + sums.outputTokens + sums.images + sums.audioSeconds + sums.characters > 0;

export const costWords = (sums: Pick<UsageSums, "costMicros" | "unpricedRequests">) => `${formatUsd(sums.costMicros)}${sums.unpricedRequests > 0 ? "+" : ""}`;

/** A group of rows: its key, label and sums, and the rows it holds. */
export type UsageGroup = { key: string; label: string; sub?: string; sums: UsageSums; rows: UsageRow[] };

/** Rows grouped by a key, largest first (by tokens, then requests). */
export function groupUsage(rows: UsageRow[], keyOf: (row: UsageRow) => { key: string; label: string; sub?: string }): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  for (const row of rows) {
    const { key, label, sub } = keyOf(row);
    const group = groups.get(key) ?? { key, label, sub, sums: emptySums(), rows: [] };
    addSums(group.sums, row);
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.sums.inputTokens + b.sums.outputTokens - (a.sums.inputTokens + a.sums.outputTokens) || b.sums.requests - a.sums.requests || a.label.localeCompare(b.label),
  );
}

export const totalOf = (rows: UsageRow[]): UsageSums => rows.reduce((sums, row) => addSums(sums, row), emptySums());

export const withOwner = (row: UsageRow) => ({ key: row.ownerId ?? "none", label: row.ownerName ?? row.ownerEmail ?? (row.storeId ? "No store owner" : "Kaizen itself"), sub: row.ownerName ? (row.ownerEmail ?? undefined) : undefined });
export const withStore = (row: UsageRow) => ({ key: row.storeId ?? "none", label: row.storeName ?? "Kaizen itself", sub: row.storeSlug ?? undefined });
export const withFeature = (row: UsageRow) => ({ key: row.feature, label: featureWords(row.feature) });
export const withModel = (row: UsageRow) => ({ key: `${row.provider}\u0000${row.model}`, label: row.model, sub: row.provider });

const sumsForModel = (sums: UsageSums) => ({
  requests: sums.requests,
  failed: sums.failed,
  input_tokens: sums.inputTokens,
  output_tokens: sums.outputTokens,
  // Worked out in code from the prices in force when each call was made (D145); the model repeats it, never computes it.
  estimated_cost_usd: Math.round(sums.costMicros / 100) / 10_000,
  ...(sums.unpricedRequests > 0 && { requests_without_a_price: sums.unpricedRequests }),
  ...(sums.characters > 0 && { characters_spoken: sums.characters }),
  ...(sums.audioSeconds > 0 && { audio_minutes: Math.round(sums.audioSeconds / 60) }),
  ...(sums.images > 0 && { pictures: sums.images }),
});

/** A report as small JSON for the AI manager to repeat: counts worked out here, never by the model. */
export function summarizeUsage(rows: UsageRow[], limit = 12) {
  const models = (list: UsageRow[]) =>
    groupUsage(list, (row) => ({ key: `${row.provider}\u0000${row.model}\u0000${row.kind}\u0000${row.source}`, label: row.model, sub: `${row.provider}, ${KIND_WORDS[row.kind]}, ${SOURCE_WORDS[row.source]}` }))
      .slice(0, limit)
      .map((g) => ({ model: g.label, provider_and_use: g.sub, ...sumsForModel(g.sums) }));
  const named = (groups: UsageGroup[]) => groups.slice(0, limit).map((g) => ({ name: g.label, ...(g.sub && { detail: g.sub }), ...sumsForModel(g.sums), models: models(g.rows).slice(0, 5) }));
  const total = totalOf(rows);
  const onKaizen = totalOf(rows.filter((r) => r.source === "platform"));
  return {
    total: sumsForModel(total),
    on_kaizens_key: { requests: onKaizen.requests, tokens: onKaizen.inputTokens + onKaizen.outputTokens, estimated_cost_usd: Math.round(onKaizen.costMicros / 100) / 10_000 },
    requests_with_counted_tokens: total.estimatedRequests,
    by_provider_and_model: models(rows),
    by_store: named(groupUsage(rows, withStore)),
    by_feature: groupUsage(rows, withFeature).slice(0, limit).map((g) => ({ feature: g.label, ...sumsForModel(g.sums) })),
    note: "Tokens are as the providers reported, or counted by Kaizen (about four characters a token) where they did not. Cost is an estimate in US dollars from the platform's price list for each model at the time of the call; requests_without_a_price used a model with no price (or no price for pictures, speech or audio), so the real cost is higher. Pictures, speech and live calls are priced per picture, per million characters and per minute where the platform has set those prices.",
  };
}
