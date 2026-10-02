/**
 * The page replicator's shared shapes (D150, `docs/page-replicator.md`): what a job is as the owner's page sees it,
 * the steps it goes through, its log and what it says at the end. Pure, so the server, the page and the tests share them.
 */

import type { ReplicaReport } from "./replicate-report";

export const ITERATIONS = { min: 1, max: 10, default: 3 } as const;

/** The steps the owner follows, in order. */
export const STEPS = {
  open: "Opening the page",
  examine: "Examining design and layout",
  copy: "Downloading the text",
  assets: "Downloading pictures, videos and fonts",
  build: "Building the page",
  refine: "Checking and improving",
  done: "Summary",
} as const;
export type ReplicaPhase = keyof typeof STEPS;
export const PHASES = Object.keys(STEPS) as ReplicaPhase[];

export type ReplicaStatus = "queued" | "running" | "done" | "failed" | "aborted";
export const ACTIVE: readonly ReplicaStatus[] = ["queued", "running"];

/** How much of the bar each step takes; the improving passes share the last big part. */
export const PHASE_WEIGHT: Record<ReplicaPhase, number> = { open: 8, examine: 14, copy: 5, assets: 20, build: 13, refine: 40, done: 0 };

export type LogLevel = "info" | "ok" | "warn" | "error";
export type ReplicaLogEntry = { at: string; level: LogLevel; phase: ReplicaPhase; text: string };
export const LOG_MAX = 400;

/** One thing the replicator did or could not do, for the summary. */
export type ReplicaNote = { level: "ok" | "warn" | "fail"; text: string };

/** A comparison of the original and the copy at one width. */
export type ReplicaScore = {
  /** How much of the original the copy matches, 0–100: pixels within a small difference, then weighted by position. */
  match: number;
  /** The weakest stretches of the page, top to bottom, in pixels of the original. */
  weakest: { y: number; height: number; match: number }[];
  /** Height of the copy against the original, in pixels. */
  heights: { original: number; copy: number };
};

export type ReplicaPass = {
  /** 0 is the first build, then one per improving pass. */
  iteration: number;
  desktop: ReplicaScore;
  mobile: ReplicaScore | null;
  /** What was changed in this pass, in words. */
  changes: string[];
  /** What the AI said of the copy this pass, when it looked: kept for the report, never acted on beyond the checked changes. */
  ai?: { summary: string; couldNotFix: string[]; refused: string[]; applied: number };
};

/** The pictures the owner watches: the original and the copy, per width, with the number of the pass the copy is from. */
export type ReplicaPreviews = {
  original: { desktop: string | null; mobile: string | null };
  copy: { desktop: string | null; mobile: string | null; iteration: number | null };
};

export type ReplicaSummary = {
  outcome: "done" | "failed" | "aborted";
  /** What went well, in sentences. */
  wentWell: string[];
  /** What failed or was approximated, in sentences. */
  problems: string[];
  /** Match of the last copy against the original, per width. */
  finalMatch: { desktop: number | null; mobile: number | null };
  passes: { iteration: number; desktop: number; mobile: number | null }[];
  counts: { rows: number; blocks: number; headings: number; texts: number; pictures: number; buttons: number; videos: number };
  /** What the AI understood of the original's design, in a few sentences; null if it did not look. */
  design: string | null;
  /** The draft page, to preview and edit; null when none was made. */
  page: { id: string; title: string } | null;
  /** Everything a developer needs to improve the replicator from this copy (`replicate-report.ts`); absent on older jobs. */
  report?: ReplicaReport;
};

/** A job as the owner's page reads it: nothing from `capture`, and no working data. */
export type ReplicaJob = {
  id: string;
  url: string;
  status: ReplicaStatus;
  phase: ReplicaPhase;
  iteration: number;
  iterationsMax: number;
  /** 0–100. */
  progress: number;
  /** What the job is doing right now, in a sentence. */
  doing: string;
  log: ReplicaLogEntry[];
  previews: ReplicaPreviews;
  passes: ReplicaPass[];
  summary: ReplicaSummary | null;
  pageId: string | null;
  abortRequested: boolean;
  createdAt: string;
  finishedAt: string | null;
};

export const finished = (status: ReplicaStatus) => !ACTIVE.includes(status);

/**
 * The bar's value: the steps behind it in full, the current one by how far it has got (`within`, 0–1). The improving
 * passes share their step's weight equally.
 */
export function progressOf(job: { status: ReplicaStatus; phase: ReplicaPhase; iteration: number; iterationsMax: number }, within = 0): number {
  if (job.status === "done") return 100;
  const total = PHASES.reduce((sum, phase) => sum + PHASE_WEIGHT[phase], 0);
  let done = 0;
  for (const phase of PHASES) {
    if (phase === job.phase) break;
    done += PHASE_WEIGHT[phase];
  }
  if (job.phase === "refine") done += PHASE_WEIGHT.refine * Math.min(1, job.iteration / Math.max(1, job.iterationsMax + 1));
  else done += PHASE_WEIGHT[job.phase] * Math.min(1, Math.max(0, within));
  return Math.max(0, Math.min(99, Math.round((done / total) * 100)));
}

/** The status of each step for the stepper: done, the one at work, or still to come; a stopped job leaves its step as it was. */
export function stepStates(job: { status: ReplicaStatus; phase: ReplicaPhase }): Record<ReplicaPhase, "done" | "active" | "waiting" | "stopped"> {
  const at = PHASES.indexOf(job.phase);
  const result = {} as Record<ReplicaPhase, "done" | "active" | "waiting" | "stopped">;
  PHASES.forEach((phase, index) => {
    if (job.status === "done") result[phase] = "done";
    else if (index < at) result[phase] = "done";
    else if (index === at) result[phase] = job.status === "running" || job.status === "queued" ? "active" : "stopped";
    else result[phase] = "waiting";
  });
  return result;
}

/** The text of a log entry's time, as a clock. */
export const clock = (at: string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Adds an entry to a log, keeping the last `LOG_MAX`. */
export function appendLog(log: ReplicaLogEntry[], entries: ReplicaLogEntry[]): ReplicaLogEntry[] {
  return [...log, ...entries].slice(-LOG_MAX);
}
