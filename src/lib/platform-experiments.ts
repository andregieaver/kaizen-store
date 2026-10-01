import { AFTER_PLANNED_END_DAYS, MAX_RUN_DAYS, type ExperimentStatus } from "./experiments";

/**
 * The platform's view of every store's A/B tests (D148, phase 5): the rules that say which tests need a look. Pure; the
 * read is `src/server/platform-experiments.ts`. The view only reads: a platform admin never starts, stops or changes a store's test.
 */

/** A running test nobody has seen after this many days is stuck: the page, the consent banner or the proxy is not doing its part. */
export const QUIET_AFTER_DAYS = 3;
/** A stopped test nobody has decided after this many days is forgotten. */
export const UNDECIDED_AFTER_DAYS = 14;

export type TestLine = {
  status: ExperimentStatus;
  startedAt: Date | null;
  stoppedAt: Date | null;
  plannedEnd: Date | null;
  stopReason: string | null;
  scheduleProblem: string | null;
  exposed: number;
  /** The verdict's kind, for a running test whose results were read. */
  verdict: string | null;
  /** The version that clearly lowers orders, for a running test whose results were read. */
  harmed: string | null;
};

export type Flag = { kind: "harmed" | "broken" | "quiet" | "overdue" | "schedule" | "undecided"; words: string };

/** An uneven split, for a test of any unit (visitors, searches or tabs). */
export const brokenFlag: Flag = { kind: "broken", words: "The visitors are not divided as planned, so its results cannot be trusted." };

const DAY = 86_400_000;
export const daysBetween = (from: Date, to: Date): number => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));
const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** What is wrong, or about to be, with a test; none for a test that is simply going well. Worst first. */
export function flagsOf(test: TestLine, now: Date): Flag[] {
  const flags: Flag[] = [];
  if (test.status === "running" && test.startedAt) {
    const age = daysBetween(test.startedAt, now);
    if (test.harmed) flags.push({ kind: "harmed", words: `Version ${test.harmed.toUpperCase()} clearly lowers orders: the hourly check stops the test.` });
    if (test.verdict === "broken") flags.push(brokenFlag);
    if (test.exposed === 0 && age >= QUIET_AFTER_DAYS) flags.push({ kind: "quiet", words: `Nobody has seen it in ${dayWord(age)}.` });
    if (test.plannedEnd && now.getTime() >= test.plannedEnd.getTime()) {
      const stops = Math.min(test.plannedEnd.getTime() + AFTER_PLANNED_END_DAYS * DAY, test.startedAt.getTime() + MAX_RUN_DAYS * DAY);
      flags.push({ kind: "overdue", words: `Past its planned end: it stops counting in ${dayWord(Math.max(0, Math.ceil((stops - now.getTime()) / DAY)))}.` });
    }
  }
  if (test.status === "draft" && test.scheduleProblem) flags.push({ kind: "schedule", words: "Its scheduled start did not happen and it went back to a draft." });
  if (test.status === "stopped" && test.stoppedAt) {
    const waiting = daysBetween(test.stoppedAt, now);
    if (test.stopReason === "guardrail") flags.push({ kind: "undecided", words: `Stopped by the guardrail ${dayWord(waiting)} ago; the owner has not decided.` });
    else if (waiting >= UNDECIDED_AFTER_DAYS) flags.push({ kind: "undecided", words: `Stopped ${dayWord(waiting)} ago and still not decided.` });
  }
  return flags;
}

/**
 * What a platform admin can usefully do about a test, in words, from its status and what it said: never to change it (the store's owner
 * does that), only to know when to say something to the owner. Used by the platform assistant (phase 8).
 */
export function adviceFor(input: { status: ExperimentStatus; verdict: string | null; guardrail: boolean; version?: string | null }): string[] {
  const { status, verdict } = input;
  const owner = "You cannot change a store's test: tell the owner, who can in the store's admin.";
  if (status === "draft" || status === "scheduled") return ["Not started: nothing to say about results. The owner starts it."];
  if (status === "applied" || status === "discarded") return ["Decided: nothing to do."];
  if (status === "stopped") {
    return input.guardrail
      ? ["The guardrail stopped it because a version was clearly selling less, and the store's owners were emailed. It waits for the owner to discard it or choose a version.", owner]
      : ["It is stopped and waits for the owner to choose a version or keep the original.", owner];
  }
  if (verdict === "broken") return ["The visitors are not divided as promised, so the figures cannot be trusted: the owner should stop it and start a new one.", owner];
  if (verdict === "few" || verdict === "early" || verdict === null) return ["Nothing to do: it cannot say anything before its minimum visitors and days. Do not read anything into the figures yet."];
  if (verdict === "better") return [`A version${input.version ? ` (${input.version})` : ""} is clearly better: the owner can stop the test and apply it.`, owner];
  return ["The original is as good or better: the owner can stop the test and keep it, or run it longer or try a bolder change.", owner];
}

/** Tests that need a look first, then running ones, then the rest, newest first within each. */
export function attentionOrder<T extends { status: ExperimentStatus; flags: Flag[]; startedAt: Date | null; createdAt: Date }>(tests: T[]): T[] {
  const rank = (t: T) => (t.flags.length > 0 ? 0 : t.status === "running" ? 1 : t.status === "scheduled" ? 2 : t.status === "stopped" ? 3 : t.status === "draft" ? 4 : 5);
  return [...tests].sort((a, b) => rank(a) - rank(b) || (b.startedAt ?? b.createdAt).getTime() - (a.startedAt ?? a.createdAt).getTime());
}

export type Overview = { running: number; scheduled: number; stopped: number; needAttention: number; stores: number };

export function overviewOf(tests: { status: ExperimentStatus; flags: Flag[]; storeId: string }[]): Overview {
  const count = (status: ExperimentStatus) => tests.filter((t) => t.status === status).length;
  return {
    running: count("running"),
    scheduled: count("scheduled"),
    stopped: count("stopped"),
    needAttention: tests.filter((t) => t.flags.length > 0).length,
    stores: new Set(tests.filter((t) => t.status === "running").map((t) => t.storeId)).size,
  };
}
