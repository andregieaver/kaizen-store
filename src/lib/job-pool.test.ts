import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pooled } from "./job-pool";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Tasks that count how many run at once; each resolves with its index after `ms`. */
function counted(n: number, ms: number) {
  const state = { running: 0, peak: 0, finished: 0 };
  const tasks = Array.from({ length: n }, (_, i) => async () => {
    state.running++;
    state.peak = Math.max(state.peak, state.running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    state.running--;
    state.finished++;
    return i;
  });
  return { state, tasks };
}

describe("pooled", () => {
  it("never runs more than four at once", async () => {
    const { state, tasks } = counted(20, 100);
    const done = pooled(tasks, { lanes: 4, laneMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(state.peak).toBe(4);
  });

  it("a job that throws does not stop the others", async () => {
    const { tasks } = counted(20, 100);
    const wrapped = tasks.map((t, i) => async () => {
      try {
        if (i === 3) throw new Error("no");
        return await t();
      } catch {
        return null;
      }
    });
    const done = pooled(wrapped, { lanes: 4, laneMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1000);
    const results = await done;
    expect(results).toHaveLength(20);
    expect(results[3]).toBeNull();
    expect(results.filter((r) => r !== null)).toHaveLength(19);
  });

  it("a job that never returns gives up its lane after laneMs", async () => {
    const { state, tasks } = counted(10, 100);
    tasks[0] = () => new Promise(() => {});
    const gaveUp: number[] = [];
    let settled = false;
    void pooled(tasks, { lanes: 2, laneMs: 1000, onLaneGivenUp: (i) => gaveUp.push(i) }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.finished).toBe(9);
    expect(gaveUp).toEqual([0]);
    expect(settled).toBe(false);
  });

  it("four hung jobs cannot stop the run", async () => {
    const { state, tasks } = counted(6, 100);
    const hung = Array.from({ length: 4 }, () => () => new Promise<number>(() => {}));
    void pooled([...hung, ...tasks], { lanes: 4, laneMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.finished).toBe(6);
  });

  it("clears the lane's timer when a job ends first", async () => {
    const { tasks } = counted(3, 100);
    const gaveUp = vi.fn();
    const done = pooled(tasks, { lanes: 1, laneMs: 1000, onLaneGivenUp: gaveUp });
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(gaveUp).not.toHaveBeenCalled();
  });

  it("works with more lanes than tasks and with no tasks", async () => {
    const { tasks } = counted(2, 10);
    const done = pooled(tasks, { lanes: 9, laneMs: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await done).toEqual([0, 1]);
    expect(await pooled([], { lanes: 4, laneMs: 1000 })).toEqual([]);
  });
});
