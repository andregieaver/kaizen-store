import { describe, expect, it } from "vitest";

import { EMPTY_MOVE, moveDue, moveStateOf, nextMoveStep, readiness, scheduleProblem } from "./shopify-move";

describe("move day", () => {
  it("reads back only what it wrote, and a scheduled move without its time or owner is none", () => {
    const by = "8a7b0f8e-3a77-4f43-9b51-6f5a8a7d6d11";
    expect(moveStateOf({ status: "moving", by, startedAt: "2026-11-04T08:00:00Z", steps: { catch_up: { stage: "done", done: 3 }, links: { stage: "boom" }, open: { stage: "failed", problem: "setup" } }, lease: "x" })).toEqual({
      ...EMPTY_MOVE,
      status: "moving",
      by,
      startedAt: "2026-11-04T08:00:00.000Z",
      steps: { catch_up: { stage: "done", done: 3 }, links: { stage: "waiting" }, open: { stage: "failed", problem: "setup" } },
    });
    expect(moveStateOf({ status: "scheduled", by }).status).toBe("none");
    expect(moveStateOf({ status: "nope", by: "x" })).toEqual(EMPTY_MOVE);
    expect(moveStateOf(null)).toEqual(EMPTY_MOVE);
  });

  it("runs its steps in order, a failed one settled, and is due only at its time", () => {
    const at = (catchUp: "waiting" | "running" | "done" | "failed", links: "waiting" | "done" | "failed", open: "waiting" | "done") => ({ ...EMPTY_MOVE, steps: { catch_up: { stage: catchUp }, links: { stage: links }, open: { stage: open } } });
    expect(nextMoveStep(at("waiting", "waiting", "waiting"))).toBe("catch_up");
    expect(nextMoveStep(at("running", "waiting", "waiting"))).toBe("catch_up");
    expect(nextMoveStep(at("failed", "waiting", "waiting"))).toBe("links");
    expect(nextMoveStep(at("done", "failed", "waiting"))).toBe("open");
    expect(nextMoveStep(at("done", "done", "done"))).toBeNull();
    const scheduled = { ...EMPTY_MOVE, status: "scheduled" as const, at: "2026-11-04T20:00:00.000Z", by: "x" };
    expect([moveDue(scheduled, new Date("2026-11-04T19:59:00Z")), moveDue(scheduled, new Date("2026-11-04T20:00:00Z"))]).toEqual([false, true]);
  });

  it("is held back by payments and an unfinished copy, never by old links or makers", () => {
    const ready = { payments: true, copyDone: true, copyFailed: 0, links: { total: 10, working: 10 }, makersLeft: 0 };
    expect(readiness(ready)).toMatchObject({ canMove: true });
    expect(readiness({ ...ready, payments: false }).canMove).toBe(false);
    expect(readiness({ ...ready, copyDone: false }).canMove).toBe(false);
    const said = readiness({ ...ready, links: { total: 10, working: 7 }, makersLeft: 4 });
    expect(said.canMove).toBe(true);
    expect(said.checks.filter((c) => !c.ok).map((c) => [c.key, c.n, c.of])).toEqual([
      ["links", 7, 10],
      ["waiting", 4, undefined],
    ]);
    expect(readiness({ ...ready, links: null }).checks.find((c) => c.key === "links")).toMatchObject({ ok: false, of: 0 });
  });

  it("takes a time at least five minutes and at most 30 days ahead", () => {
    const now = new Date("2026-11-04T08:00:00Z");
    expect([
      scheduleProblem(null, now),
      scheduleProblem("2026-11-04T08:03:00.000Z", now),
      scheduleProblem("2026-11-04T08:10:00.000Z", now),
      scheduleProblem("2026-12-05T08:10:00.000Z", now),
    ]).toEqual(["invalid", "past", null, "far"]);
  });
});
