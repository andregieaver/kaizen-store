import { TEST_FLOOR } from "./broadcast-test-sizes";
import { callRates, type Call } from "./experiment-units";
import type { FlowStep } from "./flows";

/**
 * A flow's split tests (email plan M2.5, D868, `docs/split-tests.md`), the pure part: each split's two ways side by side (people who went
 * that way and the orders its emails were credited with, over the report's 30 days), called by the A/B engine's `callRates()` with its
 * interval rule and floor, and the tree with one way kept. Code counts and calls; keeping a way is the owner's press.
 */

type Split = Extract<FlowStep, { kind: "if" }>;

/** Every `if` step whose condition is a split, in reading order. */
export function splitsOf(steps: readonly FlowStep[]): Split[] {
  const out: Split[] = [];
  const walk = (list: readonly FlowStep[]) => {
    for (const step of list) {
      if (step.kind !== "if") continue;
      if (step.condition.kind === "split") out.push(step);
      walk(step.then);
      walk(step.else);
    }
  };
  walk(steps);
  return out;
}

const all = (list: readonly FlowStep[]): FlowStep[] => list.flatMap((s) => (s.kind === "if" ? [s, ...all(s.then), ...all(s.else)] : [s]));

export type WayFigures = { people: number; orders: number };

export type SplitFigures = { id: string; first: WayFigures; second: WayFigures; call: Call; better: "then" | "else" | null };

/**
 * One split's ways: the people whose way came to any step of it (the most of any step, as every run in it reaches its first) and the
 * orders credited to its emails; called on orders per person, so `better` is set only when the engine calls a clear difference.
 */
export function splitFigures(split: Split, people: ReadonlyMap<string, number>, orders: ReadonlyMap<string, number>): SplitFigures {
  const way = (list: readonly FlowStep[]): WayFigures => {
    const steps = all(list);
    const reached = Math.max(0, ...steps.map((s) => people.get(s.id) ?? 0));
    const credited = steps.filter((s) => s.kind === "email").reduce((sum, s) => sum + (orders.get(s.id) ?? 0), 0);
    return { people: reached, orders: Math.min(credited, reached) };
  };
  const first = way(split.then);
  const second = way(split.else);
  const called = callRates({ hits: first.orders, of: first.people }, { hits: second.orders, of: second.people }, { rule: "interval", floor: TEST_FLOOR });
  // The engine compares the second way to the first: "better" is the second.
  const better = called.call === "better" ? "else" : called.call === "worse" ? "then" : null;
  return { id: split.id, first, second, call: called.call, better };
}

/** The tree with a split replaced by the steps of the way kept (the other way's steps are gone); the same tree when no split has that id. */
export function keepWay(steps: readonly FlowStep[], id: string, way: "then" | "else"): FlowStep[] {
  return steps.flatMap((step): FlowStep[] => {
    if (step.kind !== "if") return [step];
    if (step.id === id && step.condition.kind === "split") return keepWay(step[way], id, way);
    return [{ ...step, then: keepWay(step.then, id, way), else: keepWay(step.else, id, way) }];
  });
}
