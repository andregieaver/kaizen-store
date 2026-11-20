import { describe, expect, it } from "vitest";

import { FLOW_GUARD, flowGuardPauses, guardCountsOf } from "./flow-guard";

describe("the flow guard (M3.9)", () => {
  it("pauses a flow only with enough readers and more than 3 in 100 of them leaving", () => {
    expect(flowGuardPauses({ sent: FLOW_GUARD.minSent - 1, left: 20 })).toBe(false);
    expect(flowGuardPauses({ sent: 100, left: 3 })).toBe(false);
    expect(flowGuardPauses({ sent: 100, left: 4 })).toBe(true);
  });

  it("reads back the counts it kept, and nothing of another shape", () => {
    expect(guardCountsOf({ sent: 40, left: 5 })).toEqual({ sent: 40, left: 5 });
    expect(guardCountsOf({ sent: "40" })).toBeNull();
    expect(guardCountsOf(null)).toBeNull();
  });
});
