import { describe, expect, it } from "vitest";

import { LAST_ROUND_MS, nextRound, ROUND_TIMEOUT_MS, toolMayRun, TURN_DEADLINE_MS, TURN_TOKENS_MAX } from "./turn-budget";

const at = (elapsed: number, more: Partial<Parameters<typeof nextRound>[0]> = {}) =>
  nextRound({ step: 0, maxSteps: 10, now: elapsed, deadline: TURN_DEADLINE_MS, tokens: 0, ...more });

describe("a turn's budget (code review 0.8)", () => {
  it("ends well inside the route's 300 seconds", () => {
    expect(TURN_DEADLINE_MS).toBeLessThanOrEqual(250_000);
  });

  it("offers tools while there is time, keeping the last round's share", () => {
    expect(at(0)).toEqual({ kind: "tools", timeoutMs: ROUND_TIMEOUT_MS });
    // 30 s before the last round's time begins: a tool round may take only those 30 s.
    expect(at(TURN_DEADLINE_MS - LAST_ROUND_MS - 30_000)).toEqual({ kind: "tools", timeoutMs: 30_000 });
  });

  it("forces the last, tool-free round when time is short or the rounds are used up", () => {
    expect(at(TURN_DEADLINE_MS - LAST_ROUND_MS)).toEqual({ kind: "last", timeoutMs: LAST_ROUND_MS });
    expect(at(0, { step: 10 })).toEqual({ kind: "last", timeoutMs: ROUND_TIMEOUT_MS });
  });

  it("starts no round that could not finish", () => {
    expect(at(TURN_DEADLINE_MS - 1_000)).toEqual({ kind: "stop", reason: "time" });
    expect(at(TURN_DEADLINE_MS + 1)).toEqual({ kind: "stop", reason: "time" });
  });

  it("stops at the ceiling of tokens, before the time", () => {
    expect(at(0, { tokens: TURN_TOKENS_MAX - 1 }).kind).toBe("tools");
    expect(at(0, { tokens: TURN_TOKENS_MAX })).toEqual({ kind: "stop", reason: "tokens" });
  });

  it("holds small limits too (tests and the autopilot's shorter turns)", () => {
    const limits = { deadlineMs: 1_000, lastRoundMs: 400, tokens: 50 };
    expect(nextRound({ step: 0, maxSteps: 10, now: 0, deadline: 1_000, tokens: 0, limits })).toEqual({ kind: "tools", timeoutMs: 600 });
    expect(nextRound({ step: 1, maxSteps: 10, now: 700, deadline: 1_000, tokens: 0, limits })).toEqual({ kind: "last", timeoutMs: 300 });
    expect(nextRound({ step: 1, maxSteps: 10, now: 0, deadline: 1_000, tokens: 50, limits })).toEqual({ kind: "stop", reason: "tokens" });
  });

  it("lets no tool start once the last round's time has begun", () => {
    expect(toolMayRun(0, TURN_DEADLINE_MS)).toBe(true);
    expect(toolMayRun(TURN_DEADLINE_MS - LAST_ROUND_MS, TURN_DEADLINE_MS)).toBe(false);
  });
});
