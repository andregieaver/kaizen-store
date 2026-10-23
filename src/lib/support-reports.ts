import { fillWords } from "./admin-fill";
import { supportEn, type SupportMessages } from "./admin-messages/support.en";
/**
 * The support desk's report (D216, step 14; every figure is defined in `docs/analytics.md`, Support): worked out here, once, from one
 * row per conversation (`src/server/support-reports.ts` reads them; no words, no names, no customer), and repeated by the AI
 * manager's tools and the platform's per-store totals. Per desk, never per agent. Every rate and median is shown only from
 * `MIN_SUPPORT_SAMPLE` cases; counts always. Pure.
 */

import { MIN_SUPPORT_SAMPLE, type SupportMode } from "./support-rules";
import { OUTCOMES, type Outcome } from "./support-summary";
import { TONE_BANDS, bandOf, type ToneBand } from "./support-tone";

/** A conversation as the report counts it: times in milliseconds since 1970, or null. */
export type ReportConversation = {
  /** The desk's mode when it started; null before step 14 (*mode not recorded*). */
  mode: SupportMode | null;
  status: "open" | "ended";
  createdAt: number;
  queuedAt: number | null;
  claimedAt: number | null;
  firstAgentAt: number | null;
  endedAt: number | null;
  handoffReason: string | null;
  rating: "good" | "bad" | null;
  tone: number | null;
  outcome: Outcome | null;
  topics: string[];
  /** Its transcript and actions were deleted (only its own row's figures remain). */
  anonymised: boolean;
};

/** A staff request of the period's conversations. */
export type ReportRequest = {
  status: "proposed" | "done" | "declined" | "failed" | "expired";
  createdAt: number;
  decidedAt: number | null;
};

/** A share: `share` is null (not shown) below the minimum. */
export type Rate = { count: number; of: number; share: number | null };
/** A median (and a slowest tenth) in seconds: null below the minimum. */
export type Duration = {
  n: number;
  median: number | null;
  slowestTenth: number | null;
};

export type HandoffWhy =
  | "customer"
  | "ai"
  | "tone"
  | "no_ai"
  | "limit"
  | "taken_over";
export const HANDOFF_WHYS: readonly HandoffWhy[] = [
  "customer",
  "ai",
  "tone",
  "no_ai",
  "limit",
  "taken_over",
];

export type SupportReport = {
  conversations: number;
  byMode: Record<SupportMode | "unknown", number>;
  open: number;
  ended: number;
  aiAlone: Rate;
  aiResolved: Rate;
  handover: Rate;
  handoverWhy: Record<HandoffWhy, number>;
  firstAnswer: Duration;
  missed: Rate;
  timeToEnd: Duration;
  rating: Rate;
  tone: Record<ToneBand | "not_measured", number>;
  topics: { topic: string; count: number }[];
  outcomes: Record<Outcome, number>;
  requests: {
    opened: number;
    done: number;
    declined: number;
    open: number;
    other: number;
    timeToDecide: Duration;
  };
  drafts: { offered: number; used: number; share: number | null };
  /** Conversations of the period whose transcripts were deleted: their requests and drafts are not counted. */
  anonymised: number;
};

export const rate = (
  count: number,
  of: number,
  min = MIN_SUPPORT_SAMPLE,
): Rate => ({ count, of, share: of >= min && of > 0 ? count / of : null });

/** The value at a fraction of the sorted values, by nearest rank (0.5: the median, 0.9: the slowest tenth). */
export function nearestRank(
  sorted: readonly number[],
  fraction: number,
): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** A median of an even count is the mean of the middle two; the slowest tenth is a nearest rank. Seconds, whole. */
export function duration(
  seconds: readonly number[],
  min = MIN_SUPPORT_SAMPLE,
): Duration {
  const sorted = [...seconds].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < min || n === 0) return { n, median: null, slowestTenth: null };
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    median: Math.round(median),
    slowestTenth: nearestRank(sorted, 0.9),
  };
}

const seconds = (from: number, to: number) => Math.round((to - from) / 1000);

/** The report of a desk for a period, from its conversations, their staff requests and the partner's drafts. */
export function supportReport(
  conversations: readonly ReportConversation[],
  requests: readonly ReportRequest[] = [],
  drafts: { offered: number; used: number } = { offered: 0, used: 0 },
): SupportReport {
  const ended = conversations.filter((c) => c.status === "ended");
  const aiFirst = ended.filter((c) => c.mode === "ai_first");
  const alone = aiFirst.filter(
    (c) =>
      c.queuedAt === null && c.claimedAt === null && c.firstAgentAt === null,
  );
  const judged = alone.filter(
    (c) => c.outcome !== null && c.outcome !== "spam",
  );
  const handed = aiFirst.filter((c) => !alone.includes(c));
  const handoverWhy = Object.fromEntries(
    HANDOFF_WHYS.map((w) => [w, 0]),
  ) as Record<HandoffWhy, number>;
  for (const c of handed) {
    const why = (HANDOFF_WHYS as readonly string[]).includes(
      c.handoffReason ?? "",
    )
      ? (c.handoffReason as HandoffWhy)
      : "taken_over";
    handoverWhy[why] += 1;
  }
  const queuedEnded = ended.filter((c) => c.queuedAt !== null);
  const rated = conversations.filter((c) => c.rating !== null);
  const tone = Object.fromEntries(
    [...TONE_BANDS, "not_measured"].map((b) => [b, 0]),
  ) as Record<ToneBand | "not_measured", number>;
  for (const c of ended)
    tone[c.tone === null ? "not_measured" : bandOf(c.tone)] += 1;
  const topicCounts = new Map<string, number>();
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<
    Outcome,
    number
  >;
  for (const c of ended) {
    for (const topic of new Set(c.topics))
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    if (c.outcome) outcomes[c.outcome] += 1;
  }
  const byMode = { off: 0, ai_first: 0, people: 0, unknown: 0 };
  for (const c of conversations) byMode[c.mode ?? "unknown"] += 1;
  const decided = requests.filter(
    (r) =>
      (r.status === "done" || r.status === "declined") && r.decidedAt !== null,
  );
  return {
    conversations: conversations.length,
    byMode,
    open: conversations.length - ended.length,
    ended: ended.length,
    aiAlone: rate(alone.length, aiFirst.length),
    aiResolved: rate(
      judged.filter((c) => c.outcome === "resolved").length,
      judged.length,
    ),
    handover: rate(handed.length, aiFirst.length),
    handoverWhy,
    firstAnswer: duration(
      conversations
        .filter(
          (c) =>
            c.queuedAt !== null &&
            c.firstAgentAt !== null &&
            c.firstAgentAt >= c.queuedAt,
        )
        .map((c) => seconds(c.queuedAt!, c.firstAgentAt!)),
    ),
    missed: rate(
      queuedEnded.filter((c) => c.firstAgentAt === null).length,
      queuedEnded.length,
    ),
    timeToEnd: duration(
      ended
        .filter((c) => c.endedAt !== null && c.endedAt >= c.createdAt)
        .map((c) => seconds(c.createdAt, c.endedAt!)),
    ),
    rating: rate(rated.filter((c) => c.rating === "good").length, rated.length),
    tone,
    topics: [...topicCounts]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    outcomes,
    requests: {
      opened: requests.length,
      done: requests.filter((r) => r.status === "done").length,
      declined: requests.filter((r) => r.status === "declined").length,
      open: requests.filter((r) => r.status === "proposed").length,
      other: requests.filter(
        (r) => r.status === "failed" || r.status === "expired",
      ).length,
      timeToDecide: duration(
        decided.map((r) => seconds(r.createdAt, r.decidedAt!)),
      ),
    },
    drafts: {
      offered: drafts.offered,
      used: drafts.used,
      share: rate(drafts.used, drafts.offered).share,
    },
    anonymised: conversations.filter((c) => c.anonymised).length,
  };
}

type ReportUnits = SupportMessages["units"];

/** A duration in words: "45 s", "1 min 30 s", "12 min", "1 h 20 min", "2 d 4 h". */
export function durationWords(
  totalSeconds: number,
  w: ReportUnits = supportEn.units,
): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return fillWords(w.seconds, { n: s });
  // Under ten minutes the seconds matter: "1 min 30 s", never rounded up to two minutes.
  if (s < 600)
    return s % 60
      ? fillWords(w.minutesSeconds, { m: Math.floor(s / 60), n: s % 60 })
      : fillWords(w.minutes, { n: s / 60 });
  const minutes = Math.round(s / 60);
  if (minutes < 60) return fillWords(w.minutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return minutes % 60
      ? fillWords(w.hoursMinutes, { h: hours, n: minutes % 60 })
      : fillWords(w.hours, { n: hours });
  const days = Math.floor(hours / 24);
  return hours % 24
    ? fillWords(w.daysHours, { d: days, n: hours % 24 })
    : fillWords(w.days, { n: days });
}

/** What a figure below the minimum says instead of a number: "4 of the 10 needed". */
export const missingWords = (
  n: number,
  min = MIN_SUPPORT_SAMPLE,
  w: ReportUnits = supportEn.units,
) => (n === 0 ? w.noneYet : fillWords(w.needed, { n, min }));

/** A rate in words for the AI manager and the platform: "62 % (31 of 50)", or what is missing. */
export function rateWords(r: Rate): string {
  return r.share === null
    ? `Not shown: ${missingWords(r.of)}`
    : `${Math.round(r.share * 1000) / 10} % (${r.count} of ${r.of})`;
}

/** A duration figure in words: "median 3 min, slowest tenth 12 min (24 conversations)", or what is missing. */
export function durationFigureWords(d: Duration, withSlowest = true): string {
  if (d.median === null) return `Not shown: ${missingWords(d.n)}`;
  return `median ${durationWords(d.median)}${withSlowest && d.slowestTenth !== null ? `, slowest tenth ${durationWords(d.slowestTenth)}` : ""} (${d.n})`;
}
