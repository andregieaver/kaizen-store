import { COPY_PHASES, COPY_PHASE_LABELS, type CopyPhase, type StoreCopyProgress } from "./store-copy";

/**
 * What the progress page shows of a copy (D129), worked out here so it is tested: the phases as done, current or
 * waiting, the counts of what was asked, and when to ask the server again.
 */

export type PhaseState = "done" | "current" | "waiting" | "stopped";
export type PhaseStep = { phase: CopyPhase; label: string; state: PhaseState };

const STEPS: readonly CopyPhase[] = ["content", "media", "people", "orders", "finishing"];

/** The phases this copy goes through, each marked by where the copy has got to. */
export function phaseSteps(progress: Pick<StoreCopyProgress, "status" | "phase" | "counts">): PhaseStep[] {
  const at = COPY_PHASES.indexOf(progress.phase);
  return STEPS.filter((phase) => {
    if (phase === "people") return progress.counts.customers.total > 0;
    if (phase === "orders") return progress.counts.orders.total > 0;
    return true;
  }).map((phase) => {
    const index = COPY_PHASES.indexOf(phase);
    let state: PhaseState;
    if (progress.status === "done" || index < at) state = "done";
    else if (index === at) state = progress.status === "failed" ? "stopped" : "current";
    else state = "waiting";
    return { phase, label: COPY_PHASE_LABELS[phase], state };
  });
}

export const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  done: "Done",
  current: "In progress",
  waiting: "Waiting",
  stopped: "Stopped here",
};

const COUNT_LABELS = {
  pages: "Pages",
  products: "Products",
  posts: "Posts",
  customers: "Customers",
  orders: "Orders",
  media: "Pictures and files",
} as const;

export type CountRow = { key: keyof typeof COUNT_LABELS; label: string; done: number; total: number };

/** The kinds that were asked for, with how many are done of how many (never more done than the total). */
export function countRows(counts: StoreCopyProgress["counts"]): CountRow[] {
  return (Object.keys(COUNT_LABELS) as (keyof typeof COUNT_LABELS)[])
    .filter((key) => counts[key].total > 0)
    .map((key) => ({
      key,
      label: COUNT_LABELS[key],
      done: Math.min(counts[key].done, counts[key].total),
      total: counts[key].total,
    }));
}

export const countText = (row: Pick<CountRow, "done" | "total">): string =>
  `${row.done.toLocaleString("en")} of ${row.total.toLocaleString("en")}`;

/** "3 pictures could not be copied and were left out." */
export const leftOutText = (n: number): string =>
  `${n.toLocaleString("en")} ${n === 1 ? "picture or file" : "pictures and files"} could not be copied and ${n === 1 ? "was" : "were"} left out.`;

export const POLL_MS = 2500;
export const POLL_MAX_MS = 30_000;

/** When to ask again: every 2.5 seconds, then slower and slower (up to 30 seconds) after each failure in a row. */
export function pollDelay(failures: number): number {
  return Math.min(POLL_MAX_MS, POLL_MS * 2 ** Math.max(0, failures));
}
