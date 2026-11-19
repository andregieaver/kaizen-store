import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { forgetRemembered, forgetWhere, remembered } from "./short-memory";

/** A load that resolves when the test says so, counting its runs. */
function gated<T>(value: T) {
  const runs = { count: 0 };
  let open: (() => void) | null = null;
  const load = vi.fn(() => {
    runs.count += 1;
    return new Promise<T>((resolve) => {
      open = () => resolve(value);
    });
  });
  return { load, runs, open: () => open?.() };
}

describe("the short memory (bloat review step 2.20)", () => {
  let n = 0;
  /** A fresh key per test: the memory is the module's, shared across tests. */
  const key = (name = "k") => `${name}-${(n += 1)}`;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one load for 20 concurrent callers, and gives each its value", async () => {
    const k = key();
    const { load, open } = gated("v");
    const calls = Array.from({ length: 20 }, () => remembered(k, load));
    open();
    expect(await Promise.all(calls)).toEqual(Array(20).fill("v"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not run the load again within its life, and does after it", async () => {
    const k = key();
    const load = vi.fn(async () => "v");
    await remembered(k, load, 1_000);
    vi.advanceTimersByTime(999);
    await remembered(k, load, 1_000);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await remembered(k, load, 1_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects every waiting caller when the load fails, remembers nothing, and runs the load again on the next call", async () => {
    const k = key();
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("down");
      return "v";
    });
    const calls = [remembered(k, load), remembered(k, load), remembered(k, load)];
    for (const call of calls) await expect(call).rejects.toThrow("down");
    expect(load).toHaveBeenCalledTimes(1);
    fail = false;
    expect(await remembered(k, load)).toBe("v");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("starts a new load after a forget during a load, and never hands out the older read", async () => {
    const k = key();
    const older = gated("older");
    const first = remembered(k, older.load);
    forgetRemembered(k);
    const newer = gated("newer");
    const second = remembered(k, newer.load);
    expect(newer.runs.count).toBe(1);
    older.open();
    expect(await first).toBe("older");
    newer.open();
    expect(await second).toBe("newer");
    // The older read finished after the forget: it was not kept.
    expect(await remembered(k, vi.fn(async () => "third"))).toBe("newer");
  });

  it("does not keep a read that finished after its key was forgotten", async () => {
    const k = key();
    const older = gated("older");
    const first = remembered(k, older.load);
    forgetRemembered(k);
    older.open();
    expect(await first).toBe("older");
    const load = vi.fn(async () => "fresh");
    expect(await remembered(k, load)).toBe("fresh");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets by a match, remembered or in flight, and keeps the rest", async () => {
    const a = gated("a");
    await remembered("s1|a", async () => "a");
    const inFlight = remembered("s1|b", a.load);
    await remembered("s2|a", async () => "kept");
    forgetWhere((k) => k.startsWith("s1|"));
    const again = vi.fn(async () => "again");
    expect(await remembered("s1|a", again)).toBe("again");
    expect(await remembered("s1|b", again)).toBe("again");
    expect(again).toHaveBeenCalledTimes(2);
    a.open();
    await inFlight;
    expect(await remembered("s2|a", vi.fn(async () => "not run"))).toBe("kept");
  });
});
