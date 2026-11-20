import type { FlowStep } from "./flows";

/**
 * Each email's reach in the dry run (D767, email plan M3.5): how many of the people a flow would start for in the next 30 days would get
 * it. From the flow's own past once enough ways through have ended (each step's share of them, `measured`); before that, an email before
 * any branch reaches everyone who starts (`all`, less any who reach a goal), and one inside a branch at most that (`up_to`). Pure.
 */
export type StepReach = { n: number; how: "measured" | "all" | "up_to" };

/** Ended ways through the flow before its own past is trusted for each step's share. */
export const MEASURED_MIN = 20;

export function stepReach(
  steps: readonly FlowStep[],
  entering: number,
  past: { ended: number; reached: ReadonlyMap<string, number> },
): Map<string, StepReach> {
  const out = new Map<string, StepReach>();
  const measured = past.ended >= MEASURED_MIN;
  const walk = (list: readonly FlowStep[], inBranch: boolean) => {
    for (const step of list) {
      if (step.kind === "email") {
        out.set(
          step.id,
          measured
            ? { n: Math.round((entering * Math.min(past.reached.get(step.id) ?? 0, past.ended)) / past.ended), how: "measured" }
            : { n: entering, how: inBranch ? "up_to" : "all" },
        );
      }
      if (step.kind === "if") {
        walk(step.then, true);
        walk(step.else, true);
      }
    }
  };
  walk(steps, false);
  return out;
}
