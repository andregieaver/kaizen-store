import { describe, expect, it } from "vitest";

import { progressOf } from "./store-copy-test-support";
import { POLL_MAX_MS, POLL_MS, countRows, countText, leftOutText, phaseSteps, pollDelay } from "./store-copy-progress";

describe("a copy's steps", () => {
  it("marks the steps done, current and waiting", () => {
    const steps = phaseSteps(progressOf({ phase: "media" }));
    expect(steps.map((s) => [s.phase, s.state])).toEqual([
      ["content", "done"],
      ["media", "current"],
      ["people", "waiting"],
      ["finishing", "waiting"],
    ]);
  });

  it("leaves out the steps for what was not asked", () => {
    const counts = { ...progressOf().counts, customers: { done: 0, total: 0 } };
    expect(phaseSteps(progressOf({ counts })).map((s) => s.phase)).toEqual(["content", "media", "finishing"]);
    const withOrders = { ...progressOf().counts, orders: { done: 0, total: 5 } };
    expect(phaseSteps(progressOf({ counts: withOrders })).map((s) => s.phase)).toContain("orders");
  });

  it("has everything done when done, and stops at the failed step", () => {
    expect(phaseSteps(progressOf({ status: "done", phase: "done" })).every((s) => s.state === "done")).toBe(true);
    const failed = phaseSteps(progressOf({ status: "failed", phase: "media" }));
    expect(failed.find((s) => s.phase === "media")?.state).toBe("stopped");
    expect(failed.find((s) => s.phase === "content")?.state).toBe("done");
    expect(phaseSteps(progressOf({ phase: "queued" })).every((s) => s.state === "waiting")).toBe(true);
  });
});

describe("what is counted", () => {
  it("lists only the kinds asked for, never more done than the total", () => {
    const rows = countRows({ ...progressOf().counts, media: { done: 95, total: 90 } });
    expect(rows.map((r) => r.key)).toEqual(["pages", "products", "posts", "customers", "media"]);
    expect(countText(rows.find((r) => r.key === "media")!)).toBe("90 of 90");
    expect(countText({ done: 1200, total: 5000 })).toBe("1,200 of 5,000");
  });

  it("says how many pictures were left out", () => {
    expect(leftOutText(1)).toBe("1 picture or file could not be copied and was left out.");
    expect(leftOutText(3)).toBe("3 pictures and files could not be copied and were left out.");
  });
});

describe("when to ask again", () => {
  it("waits 2.5 seconds, then backs off to 30", () => {
    expect(pollDelay(0)).toBe(POLL_MS);
    expect(pollDelay(1)).toBe(POLL_MS * 2);
    expect(pollDelay(3)).toBe(POLL_MS * 8);
    expect(pollDelay(50)).toBe(POLL_MAX_MS);
  });
});
