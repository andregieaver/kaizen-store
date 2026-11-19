import { describe, expect, it } from "vitest";

import { RECIPES } from "./flow-recipes";
import { advance, checkFlow, flowInputSchema, type FlowFacts, type FlowPath } from "./flows";

const facts = (orderedSinceEntry: boolean): FlowFacts => ({ orderedSinceEntry, clickedFlowEmail: false, segments: new Set() });

/** The emails a person gets walking a tree with these facts, waits taken at once. */
function emails(steps: Parameters<typeof advance>[0], f: FlowFacts): string[] {
  const out: string[] = [];
  let path: FlowPath | null = ["0"];
  for (let i = 0; i < 50; i++) {
    const move = advance(steps, [], path, f);
    if (move.do === "end") break;
    if (move.do === "email") out.push(move.step.id);
    path = move.next;
  }
  return out;
}

describe("the goals a flow starts from (D767 slice 3, M3.1)", () => {
  it("makes every recipe a sound flow in Norwegian and English, naming the automation it replaces", () => {
    for (const [key, recipe] of Object.entries(RECIPES)) {
      for (const locale of ["nb-NO", "en-GB"]) {
        const flow = recipe(locale);
        expect(flowInputSchema.safeParse(flow).success, key).toBe(true);
        expect(checkFlow(flow.steps), key).toEqual([]);
        expect(flow.replaces).toBe(key);
      }
    }
  });

  it("follows up a purchase a week later, and sends something new only to someone who has not ordered again", () => {
    const steps = RECIPES.after_purchase("en-GB").steps;
    expect(emails(steps, facts(false))).toEqual(["how", "again"]);
    expect(emails(steps, facts(true))).toEqual(["how"]);
    expect(RECIPES.after_purchase("nb-NO").name).toBe("Etter et kjøp");
  });
});
