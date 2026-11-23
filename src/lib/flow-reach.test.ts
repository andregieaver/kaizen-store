import { describe, expect, it } from "vitest";

import { MEASURED_MIN, stepReach } from "./flow-reach";
import type { FlowStep } from "./flows";

const email = (id: string): FlowStep => ({ id, kind: "email", content: { "en-GB": { subject: id, preview: "", blocks: [{ type: "paragraph", text: id }] } } });
const steps: FlowStep[] = [
  email("a"),
  { id: "w", kind: "wait", hours: 72 },
  { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("b")], else: [email("c")] },
];

describe("each email's reach in the dry run (M3.5)", () => {
  it("before the flow has a past: everyone who starts before a branch, at most that inside one", () => {
    expect(Object.fromEntries(stepReach(steps, 40, { ended: 3, reached: new Map([["a", 3]]) }))).toEqual({
      a: { n: 40, how: "all" },
      b: { n: 40, how: "up_to" },
      c: { n: 40, how: "up_to" },
    });
  });

  it("from the flow's own past once enough ways through have ended: each email's share of them", () => {
    const reached = new Map([["a", 50], ["b", 10], ["c", 35]]);
    expect(Object.fromEntries(stepReach(steps, 40, { ended: 50, reached }))).toEqual({
      a: { n: 40, how: "measured" },
      b: { n: 8, how: "measured" },
      c: { n: 28, how: "measured" },
    });
    expect(stepReach(steps, 40, { ended: MEASURED_MIN, reached: new Map() }).get("b")).toEqual({ n: 0, how: "measured" });
  });
});

describe("reach behind a split (M2.5, D868)", () => {
  it("is about half in each half, and at most that behind a condition inside one", () => {
    const steps: FlowStep[] = [
      {
        id: "s",
        kind: "if",
        condition: { kind: "split" },
        then: [{ id: "a", kind: "email", content: {} }],
        else: [{ id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [{ id: "b", kind: "email", content: {} }], else: [] }],
      },
    ];
    const reach = stepReach(steps, 1000, { ended: 0, reached: new Map() });
    expect(reach.get("a")).toEqual({ n: 500, how: "all" });
    expect(reach.get("b")).toEqual({ n: 500, how: "up_to" });
  });
});
