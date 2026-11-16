import { describe, expect, it, vi } from "vitest";

import { progressTick } from "./progress-poll";

describe("a progress poll's tick (bloat review step 0.17)", () => {
  it("asks nothing in a hidden tab", async () => {
    const status = vi.fn(async () => "a");
    const refresh = vi.fn();
    await progressTick({ visible: false, status, last: { value: null }, refresh });
    await progressTick({ visible: false, last: { value: null }, refresh });
    expect(status).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks the status each tick and redraws nothing while the answer is the same", async () => {
    const status = vi.fn(async () => "same");
    const refresh = vi.fn();
    const last = { value: null as string | null };
    for (let i = 0; i < 3; i += 1) await progressTick({ visible: true, status, last, refresh });
    expect(status).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("redraws exactly once when the answer changes", async () => {
    const answers = ["one", "one", "two", "two"];
    const status = vi.fn(async () => answers.shift() ?? "two");
    const refresh = vi.fn();
    const last = { value: null as string | null };
    for (let i = 0; i < 4; i += 1) await progressTick({ visible: true, status, last, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(last.value).toBe("two");
  });

  it("redraws on every visible tick when there is no status to ask", async () => {
    const refresh = vi.fn();
    await progressTick({ visible: true, last: { value: null }, refresh });
    await progressTick({ visible: true, last: { value: null }, refresh });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("redraws nothing when the status fails, and tries again next tick", async () => {
    const refresh = vi.fn();
    const last = { value: "x" as string | null };
    await progressTick({ visible: true, status: async () => Promise.reject(new Error("offline")), last, refresh });
    expect(refresh).not.toHaveBeenCalled();
    expect(last.value).toBe("x");
  });

  it("does not redraw on the first answer: the page is already current", async () => {
    const refresh = vi.fn();
    const last = { value: null as string | null };
    await progressTick({ visible: true, status: async () => "first", last, refresh });
    expect(refresh).not.toHaveBeenCalled();
    expect(last.value).toBe("first");
  });

  it("redraws when the run moved before the first tick, measured from what the page drew", async () => {
    // RefreshWhile seeds `last` with the fingerprint the server drew the page from, so a change before the first tick is not taken as the baseline.
    const refresh = vi.fn();
    const last = { value: "drawn" as string | null };
    await progressTick({ visible: true, status: async () => "moved", last, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(last.value).toBe("moved");
  });
});
