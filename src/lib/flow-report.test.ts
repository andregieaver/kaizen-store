import { describe, expect, it } from "vitest";

import { flowSuggestion, type FlowReport } from "./flow-report";

const report = (over: Partial<FlowReport>): FlowReport => ({ entered: 0, sent: 0, orders: 0, minor: {}, topStep: null, left: 0, ...over });

describe("a flow's one suggestion (D767, M3.8)", () => {
  it("asks to space emails out when many leave, before anything else", () => {
    expect(flowSuggestion(report({ entered: 100, left: 8, sent: 200, orders: 5, topStep: { id: "a", orders: 5 } }))).toBe("space_out");
  });
  it("suggests products picked per reader when emails bring no orders", () => {
    expect(flowSuggestion(report({ entered: 50, sent: 40 }))).toBe("add_picks");
  });
  it("builds on the step that works, and says nothing on too little to go on", () => {
    expect(flowSuggestion(report({ entered: 50, sent: 40, orders: 4, topStep: { id: "a", orders: 3 } }))).toBe("build_on_top");
    expect(flowSuggestion(report({ entered: 3, sent: 3 }))).toBe("none");
  });
});
