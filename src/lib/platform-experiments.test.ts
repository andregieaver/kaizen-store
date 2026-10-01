import { describe, expect, it } from "vitest";

import { attentionOrder, flagsOf, overviewOf, type TestLine } from "./platform-experiments";

const now = new Date("2026-10-20T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const running = (over: Partial<TestLine> = {}): TestLine => ({
  status: "running", startedAt: day(5), stoppedAt: null, plannedEnd: new Date(now.getTime() + 9 * 86_400_000), stopReason: null,
  scheduleProblem: null, exposed: 300, verdict: "early", harmed: null, ...over,
});

describe("flagsOf", () => {
  it("says nothing of a test going well", () => expect(flagsOf(running(), now)).toEqual([]));

  it("names the version that lowers orders", () => {
    expect(flagsOf(running({ harmed: "b" }), now)[0]).toMatchObject({ kind: "harmed" });
    expect(flagsOf(running({ harmed: "b" }), now)[0].words).toContain("Version B");
  });

  it("flags a broken split", () => expect(flagsOf(running({ verdict: "broken" }), now).map((f) => f.kind)).toEqual(["broken"]));

  it("flags a test nobody has seen only after three days", () => {
    expect(flagsOf(running({ exposed: 0, startedAt: day(2) }), now)).toEqual([]);
    expect(flagsOf(running({ exposed: 0, startedAt: day(3) }), now).map((f) => f.kind)).toEqual(["quiet"]);
  });

  it("counts down a test past its planned end to when it stops counting", () => {
    const [flag] = flagsOf(running({ plannedEnd: day(2) }), now);
    expect(flag.kind).toBe("overdue");
    expect(flag.words).toContain("5 days");
  });

  it("caps the grace at the longest a test may run", () => {
    const [flag] = flagsOf(running({ startedAt: day(89), plannedEnd: day(1) }), now);
    expect(flag.words).toContain("1 day.");
  });

  it("flags a scheduled start that went back to a draft", () => {
    const draft = running({ status: "draft", startedAt: null, scheduleProblem: "Publish it first." });
    expect(flagsOf(draft, now).map((f) => f.kind)).toEqual(["schedule"]);
    expect(flagsOf({ ...draft, scheduleProblem: null }, now)).toEqual([]);
  });

  it("flags a guardrail stop at once and another stop only when it has waited two weeks", () => {
    const stopped = running({ status: "stopped", stoppedAt: day(1), stopReason: "guardrail" });
    expect(flagsOf(stopped, now).map((f) => f.kind)).toEqual(["undecided"]);
    expect(flagsOf({ ...stopped, stopReason: "person" }, now)).toEqual([]);
    expect(flagsOf({ ...stopped, stopReason: "person", stoppedAt: day(14) }, now).map((f) => f.kind)).toEqual(["undecided"]);
  });

  it("looks at nothing once a test is decided", () => {
    expect(flagsOf(running({ status: "applied", harmed: "b", exposed: 0 }), now)).toEqual([]);
  });
});

describe("attentionOrder and overviewOf", () => {
  const make = (status: TestLine["status"], flags: number, started: number) => ({
    status, storeId: "s1", flags: Array.from({ length: flags }, () => ({ kind: "quiet" as const, words: "" })),
    startedAt: day(started), createdAt: day(started + 1),
  });

  it("puts what needs a look first, then running, scheduled, stopped, the rest", () => {
    const tests = [make("applied", 0, 1), make("stopped", 0, 1), make("running", 0, 9), make("running", 1, 8), make("scheduled", 0, 1), make("running", 0, 2)];
    expect(attentionOrder(tests).map((t) => `${t.status}${t.flags.length}`)).toEqual(["running1", "running0", "running0", "scheduled0", "stopped0", "applied0"]);
    // Newest first among equals.
    expect(attentionOrder(tests)[1].startedAt).toEqual(day(2));
  });

  it("counts by status, what needs a look and the stores with something running", () => {
    const tests = [{ ...make("running", 1, 3), storeId: "a" }, { ...make("running", 0, 3), storeId: "a" }, { ...make("running", 0, 3), storeId: "b" }, make("scheduled", 0, 0), make("stopped", 0, 3)];
    expect(overviewOf(tests)).toEqual({ running: 3, scheduled: 1, stopped: 1, needAttention: 1, stores: 2 });
  });
});
