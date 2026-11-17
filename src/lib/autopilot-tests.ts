import { countWords, fillWords } from "./admin-fill";
import { COUNTED_GOALS, goalEstimate, type CountedGoal, type TrafficFacts } from "./experiment-traffic";
import type { VerdictKind } from "./experiment-results";
import type { ExperimentStatus } from "./experiments";

/**
 * The autopilot tests its page changes first (ecosystem plan E4.1, D729): when it would publish a change to a live page by itself and the
 * page's visitors would answer an A/B test soon enough, it starts one instead, the live page as the original and its change as version B, and
 * the change goes live only when the test answers for it. Pure: how long is soon enough, which goal a test counts, and what the store does with
 * the test once it has a verdict (`src/server/autopilot-tests.ts` starts them, `src/server/autopilot-test-decider.ts` decides them).
 */

/**
 * The longest a test of the autopilot's change may take at the store's traffic: three weeks. A test runs whole weeks and at least two
 * (`MIN_DAYS`), so this is a test of two or three weeks; longer holds a change back too long, and the change is published as before, guarded by
 * the watch (D628).
 */
export const AUTOPILOT_TEST_MAX_DAYS = 21;

/** The change in a goal's rate the test is sized to find: a fifth more or less, the new-test form's own default. */
export const AUTOPILOT_TEST_CHANGE = 0.2;

/** What a publish became: a test, and the goal it counts and the days it was sized for. */
export type TestChoice = { goal: CountedGoal; days: number };

/** Why a publish was not tested and goes live as before, guarded by the watch (D628). */
export type NotTested = "off" | "not_live" | "not_testable" | "no_room" | "not_counted" | "too_slow";

/**
 * The goal a test of the target counts and how long it takes at today's traffic, or why there is none soon enough: orders when they answer
 * within `AUTOPILOT_TEST_MAX_DAYS`, else the counted goal that answers soonest within it (adding to the cart has a higher rate, so a smaller
 * store learns sooner from it). Two versions, everyone who accepts statistics cookies.
 */
export function chooseTest(facts: TrafficFacts, targetId: string, maxDays = AUTOPILOT_TEST_MAX_DAYS): TestChoice | { none: "not_counted" | "too_slow" } {
  const estimates = COUNTED_GOALS.map((goal) => ({ goal, estimate: goalEstimate({ facts, targetId, goal, trafficShare: 1, versions: 2, relativeChange: AUTOPILOT_TEST_CHANGE }) }));
  const known = estimates.filter((e): e is { goal: CountedGoal; estimate: NonNullable<typeof e.estimate> } => e.estimate !== null);
  if (known.length === 0) return { none: "not_counted" };
  const soon = known.filter((e) => e.estimate.days <= maxDays);
  const orders = soon.find((e) => e.goal === "orders");
  const best = orders ?? [...soon].sort((a, b) => a.estimate.days - b.estimate.days)[0];
  return best ? { goal: best.goal, days: best.estimate.days } : { none: "too_slow" };
}

/** What the store does with one of the autopilot's tests now: wait, make the change live, keep the page as it was, or leave it to a person. */
export type TestAction = "wait" | "apply" | "keep" | "leave";

/**
 * The store's decision on a test the autopilot started, by code from its verdict (`verdictOf()`), never by a model:
 * - a version that is clearly better (`better`, version B) goes live, within the owner's levels (`apply`), unless a guardrail stopped the test;
 * - a change that is clearly worse, a test its guardrail stopped, a broken split, or a test whose time is up without an answer for the change keeps
 *   the page as it was (`keep`): the change did not earn its place, and keeping what was live is what the watch's rollback does too;
 * - a test a person stopped is theirs to decide (`leave`);
 * - anything else waits for more visitors and days.
 */
export function testAction(input: {
  status: ExperimentStatus;
  stopReason: string | null;
  verdict: VerdictKind;
  best: string | null;
  /** A guardrail finds the version clearly harms orders, speed or payments at checkout (`experimentResults().harmed`). */
  harmed?: boolean;
  plannedEnd: string | null;
  now: Date;
}): TestAction {
  const { status, verdict } = input;
  if (status !== "running" && status !== "stopped") return "leave";
  if (status === "stopped" && input.stopReason === "person") return "leave";
  // A guardrail stopped it, or would at its next look: the change harms what keeps the store safe (orders, speed, payments), whatever its goal says.
  if ((status === "stopped" && input.stopReason === "guardrail") || input.harmed) return "keep";
  if (verdict === "better" && input.best === "b") return "apply";
  if (status === "stopped" || verdict === "worse" || verdict === "broken") return "keep";
  const ended = input.plannedEnd !== null && input.now.getTime() >= Date.parse(input.plannedEnd);
  return ended ? "keep" : "wait";
}

/** Whole days left until the test's planned end, at least one while it runs (it may answer sooner). */
export function daysLeft(plannedEnd: string | null, now: Date, fallbackDays = AUTOPILOT_TEST_MAX_DAYS): number {
  if (!plannedEnd) return fallbackDays;
  return Math.max(1, Math.ceil((Date.parse(plannedEnd) - now.getTime()) / 86_400_000));
}

/** How the store decided an autopilot test (`autopilot_tests.outcome`); null while it is still undecided. */
export const AUTOPILOT_TEST_OUTCOMES = ["applied", "asked", "kept", "left"] as const;
export type AutopilotTestOutcome = (typeof AUTOPILOT_TEST_OUTCOMES)[number];

/** What the owner is told of one of the autopilot's tests, as a state the page and the report word. */
export const TEST_STATES = ["testing", "waiting", "live", "kept", "decided"] as const;
export type TestState = (typeof TEST_STATES)[number];

/** The words of each state, in the autopilot's own voice: the Autopilot page's (`assistant`) and the report's (`staff-emails`). */
export type TestWords = { testing: { one: string; many: string }; waiting: string; live: string; kept: string; decided: string };

/** One test in a line: "Testing my change to {page} against the current page: about N days left", and so on for each state. */
export function testLine(test: { page: string; state: TestState; daysLeft: number | null }, w: TestWords): string {
  if (test.state === "testing") return countWords(test.daysLeft ?? AUTOPILOT_TEST_MAX_DAYS, w.testing, { page: test.page });
  return fillWords(w[test.state], { page: test.page });
}

/** The state of a test from its status, how it ended and the store's own decision. */
export function testState(status: ExperimentStatus, appliedVariant: string | null, outcome: AutopilotTestOutcome | null): TestState {
  if (status === "applied") return appliedVariant === "b" && outcome !== "left" ? "live" : "decided";
  if (status === "discarded") return outcome === "kept" ? "kept" : "decided";
  if (outcome === "asked") return "waiting";
  if (outcome === "left") return "decided";
  return "testing";
}

/** How many days a decided test of the autopilot's stays on its page and in its report. */
export const DECIDED_SHOWN_DAYS = 14;
