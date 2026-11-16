import { MIN_PER_ARM } from "./experiment-stats";
import { compareToOriginal, normalQuantile, type VariantFigures, type VerdictKind } from "./experiment-results";
import { GOAL_WORDS, type ExperimentStatus, type Goal } from "./experiments";

/**
 * One A/B test as a person reads it (D148 phase 12, D650, `docs/ab-testing-usability.md`): which stage it is at, how far it is from an
 * answer and when that is likely, each version's change against the original with its likely range, and the one next step. Pure and
 * worked out from what `experimentResults()` counted, so the test's page, the AI manager's `explain_results` (and the platform's
 * `explain_ab_test`, which reads it) say the same thing. The range uses the verdict's own level (the stricter one with several versions),
 * so a range that crosses "no change" is exactly a verdict of no clear difference: the page and the sentence cannot disagree.
 */

/** The stage a person sees: the statuses, with `running` told apart by whether there is an answer yet. */
export type CardState = "draft" | "scheduled" | "learning" | "answer" | "broken" | "applied" | "discarded";

/** The page's one main step. */
export type NextStep = "start" | "wait" | "use" | "keep_original" | "start_again" | "done";

export type CardComparison = {
  key: string;
  /** The original's rate (a share) or revenue per visitor (minor units), and this version's. */
  original: number;
  version: number;
  /** The change as a share of the original, and its likely range at the verdict's level; null while the original has none. */
  relative: number | null;
  low: number | null;
  high: number | null;
  /** How likely the version is better, one-sided; for the details only, never shown alone beside a verdict. */
  chanceBetter: number;
  /** Where the range lies: wholly above no change, wholly below, or across it. */
  side: "better" | "worse" | "unsure";
};

export type ExperimentCard = {
  state: CardState;
  next: NextStep;
  /** The version to use, for `next: "use"`. */
  best: string | null;
  progress: {
    days: number;
    minDays: number;
    /** Visitors of the version with the fewest, and the least each needs. */
    visitors: number;
    minVisitors: number;
    /** How far along, 0 to 1: the lesser of days and visitors. */
    share: number;
    /** Both minimums are reached. */
    reached: boolean;
    /** The day the minimums are likely reached at today's pace (YYYY-MM-DD); null when reached or nothing to go on. */
    readyAround: string | null;
  };
  comparisons: CardComparison[];
  /** Whether figures may be shown beside the verdict: only once it has an answer (no peeking while too early, nothing on a broken split). */
  showFigures: boolean;
};

export type CardInput = {
  status: ExperimentStatus;
  goal: Goal;
  minDays: number;
  minVisitors: number;
  /** What was counted; absent before a test starts. */
  results: { figures: VariantFigures[]; days: number; verdict: { kind: VerdictKind; best: string | null } } | null;
  now: Date;
};

const DAY = 86_400_000;

/** The day, `days` from `now`, as YYYY-MM-DD. */
const dayFrom = (now: Date, days: number) => new Date(now.getTime() + Math.ceil(days) * DAY).toISOString().slice(0, 10);

/** The test as a person reads it. */
export function experimentCard(input: CardInput): ExperimentCard {
  const { status, results } = input;
  const minVisitors = Math.max(input.minVisitors, MIN_PER_ARM);
  const figures = results?.figures ?? [];
  const fewest = figures.length > 0 ? Math.min(...figures.map((f) => f.visitors)) : 0;
  const days = results?.days ?? 0;
  const reached = results !== null && days >= input.minDays && fewest >= minVisitors;
  const share = results === null ? 0 : Math.min(1, input.minDays > 0 ? days / input.minDays : 1, minVisitors > 0 ? fewest / minVisitors : 1);

  // When: the days still needed, and the visitors still needed at the pace the version with the fewest has had so far.
  let readyAround: string | null = null;
  if (results !== null && !reached && (status === "running" || status === "scheduled")) {
    const daysLeft = Math.max(0, input.minDays - days);
    const pace = days > 0 ? fewest / days : 0;
    const visitorsLeft = Math.max(0, minVisitors - fewest);
    if (visitorsLeft === 0) readyAround = dayFrom(input.now, daysLeft);
    else if (pace > 0) readyAround = dayFrom(input.now, Math.max(daysLeft, visitorsLeft / pace));
  }

  const kind = GOAL_WORDS[input.goal].kind;
  const original = figures.find((f) => f.key === "a");
  const others = figures.filter((f) => f.key !== "a");
  const z = normalQuantile(1 - 0.025 / Math.max(1, others.length));
  const comparisons: CardComparison[] = original
    ? others.flatMap((f) => {
        const c = compareToOriginal(kind, original, f, z);
        if (!c) return [];
        const base = c.original;
        return [
          {
            key: f.key,
            original: c.original,
            version: c.version,
            relative: c.relative,
            low: base > 0 ? c.low / base : null,
            high: base > 0 ? c.high / base : null,
            chanceBetter: c.chanceBetter,
            side: c.low > 0 ? "better" : c.high < 0 ? "worse" : "unsure",
          } satisfies CardComparison,
        ];
      })
    : [];

  const verdict = results?.verdict.kind ?? null;
  const state: CardState =
    status === "draft" || status === "scheduled" || status === "applied" || status === "discarded"
      ? status
      : verdict === "broken"
        ? "broken"
        : verdict === "better" || verdict === "worse" || verdict === "even"
          ? "answer"
          : "learning";
  const next: NextStep =
    state === "draft" || state === "scheduled"
      ? "start"
      : state === "learning"
        ? status === "stopped"
          ? "keep_original"
          : "wait"
        : state === "broken"
          ? "start_again"
          : state === "answer"
            ? verdict === "better"
              ? "use"
              : "keep_original"
            : "done";
  return {
    state,
    next,
    best: next === "use" ? (results?.verdict.best ?? null) : null,
    progress: { days, minDays: input.minDays, visitors: fewest, minVisitors, share, reached, readyAround },
    comparisons,
    showFigures: verdict === "better" || verdict === "worse" || verdict === "even",
  };
}
