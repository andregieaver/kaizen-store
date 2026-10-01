import { callRates, sayCall, splitP, UNITS, type Call, type Rule, type Unit } from "./experiment-units";
import type { Rate } from "./experiment-stats";
import { brokenFlag, flagsOf, type Flag } from "./platform-experiments";

/**
 * The tests that run on their own, in the platform's view of tests (D148, phase 7): the search test (D77), which every store takes part
 * in while it runs, and each store's recommendations held-out ranking (D139, D140). They count searches and tabs rather than visitors who
 * accepted cookies, and keep their own logs; here they are read in the engine's words, with the engine's flags. Pure: the reads are
 * `src/server/platform-unit-tests.ts`.
 */

export type UnitTestRow = {
  id: string;
  kind: "search" | "recommendations";
  /** The store it runs in; null for the search test, which runs in every store. */
  store: { slug: string; name: string } | null;
  name: string;
  status: "running" | "stopped";
  startedAt: Date | null;
  unit: Unit;
  control: { name: string; units: number };
  treatment: { name: string; units: number };
  call: Call;
  headline: string;
  detail: string;
  flags: Flag[];
};

export type UnitTestInput = {
  id: string;
  kind: UnitTestRow["kind"];
  store: UnitTestRow["store"];
  name: string;
  status: UnitTestRow["status"];
  startedAt: Date | null;
  stoppedAt?: Date | null;
  unit: Unit;
  control: { name: string; units: number };
  treatment: { name: string; units: number };
  /** What the rate counts, finishing "… of the searches …". */
  measure: string;
  /** The rate compared: the units of each arm that did the thing, out of those that could. */
  controlRate: Rate;
  treatmentRate: Rate;
  rule: Rule;
  /** The share of units the control was meant to get: the split is checked against it. */
  controlShare: number;
  lowerIsBetter?: boolean;
};

/** One test as a line of the platform's view: the call and its words from the engine, the flags from `flagsOf()`. */
export function unitTestRow(input: UnitTestInput, now: Date): UnitTestRow {
  const units = input.control.units + input.treatment.units;
  const chance = splitP(input.control.units, input.treatment.units, input.controlShare);
  const called = callRates(input.controlRate, input.treatmentRate, { rule: input.rule, floor: UNITS[input.unit].floor, splitChance: chance, lowerIsBetter: input.lowerIsBetter });
  const said = sayCall({
    unit: input.unit,
    call: called,
    control: input.controlRate,
    treatment: input.treatmentRate,
    controlName: input.control.name,
    treatmentName: input.treatment.name,
    measure: input.measure,
    units: { control: input.control.units, treatment: input.treatment.units },
  });
  // An uneven split is flagged whenever the test is running; a test nobody is counted in (when it has a start) by `flagsOf()` too.
  const quiet = flagsOf(
    { status: input.status, startedAt: input.startedAt, stoppedAt: null, plannedEnd: null, stopReason: null, scheduleProblem: null, exposed: units, verdict: null, harmed: null },
    now,
  ).filter((flag) => flag.kind === "quiet");
  const flags: Flag[] = [...(input.status === "running" && called.call === "broken" ? [brokenFlag] : []), ...quiet];
  return {
    id: input.id,
    kind: input.kind,
    store: input.store,
    name: input.name,
    status: input.status,
    startedAt: input.startedAt,
    unit: input.unit,
    control: input.control,
    treatment: input.treatment,
    call: called.call,
    headline: said.headline,
    detail: said.detail,
    flags,
  };
}
