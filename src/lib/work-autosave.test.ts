import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveQueue, NETWORK_MESSAGE, type SaveResult, type SaveState } from "./work-autosave";

/** An editor stand-in: the value it holds, what was saved, and a save that finishes when the test says so. */
function editor(opts: { savedKey?: string | null; failWith?: string } = {}) {
  let value: string | null = "start";
  const saved: string[] = [];
  const states: SaveState[] = [];
  const messages: (string | undefined)[] = [];
  const gates: (() => void)[] = [];
  let hold = false;
  let fail = opts.failWith ?? null;
  const queue = new AutosaveQueue<string>({
    delayMs: 600,
    savedKey: opts.savedKey === undefined ? "start" : opts.savedKey,
    read: () => (value === null ? null : { value, key: value }),
    save: async (v) => {
      saved.push(v);
      if (hold) await new Promise<void>((resolve) => gates.push(resolve));
      if (fail) throw new Error(fail);
      return { ok: true } satisfies SaveResult;
    },
    onState: (state, message) => {
      states.push(state);
      messages.push(message);
    },
  });
  return {
    queue,
    saved,
    states,
    messages,
    type(next: string | null) {
      value = next;
      queue.touch();
    },
    hold() {
      hold = true;
    },
    release() {
      hold = false;
      gates.splice(0).forEach((open) => open());
    },
    failWith(message: string | null) {
      fail = message;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the invoice's autosave", () => {
  it("waits 600 ms after the last change and saves once, however many changes came", async () => {
    const e = editor();
    e.type("a");
    await vi.advanceTimersByTimeAsync(400);
    e.type("ab");
    await vi.advanceTimersByTimeAsync(400);
    e.type("abc");
    expect(e.saved).toEqual([]);
    expect(e.states.at(-1)).toBe("pending");
    await vi.advanceTimersByTimeAsync(599);
    expect(e.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(e.saved).toEqual(["abc"]);
    expect(e.states.at(-1)).toBe("saved");
  });

  it("does not save what is already saved, and says it is saved", async () => {
    const e = editor();
    e.type("start");
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.saved).toEqual([]);
    expect(e.states.at(-1)).toBe("saved");
  });

  it("queues one more save behind a save on its way, and reads the value as it is by then", async () => {
    const e = editor();
    e.hold();
    e.type("one");
    await vi.advanceTimersByTimeAsync(600);
    expect(e.saved).toEqual(["one"]);
    expect(e.states.at(-1)).toBe("saving");
    // Typing during the save; the pause ends while it is still on its way: nothing starts beside it.
    e.type("one two");
    await vi.advanceTimersByTimeAsync(600);
    e.type("one two three");
    await vi.advanceTimersByTimeAsync(600);
    expect(e.saved).toEqual(["one"]);
    e.release();
    await vi.advanceTimersByTimeAsync(0);
    // The one queued save carries the latest value, once.
    expect(e.saved).toEqual(["one", "one two three"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.saved).toEqual(["one", "one two three"]);
    expect(e.states.at(-1)).toBe("saved");
  });

  it("waits for a running pause rather than saving at once when a save ends", async () => {
    const e = editor();
    e.hold();
    e.type("x");
    await vi.advanceTimersByTimeAsync(600);
    e.type("xy");
    e.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.saved).toEqual(["x"]);
    expect(e.states.at(-1)).toBe("pending");
    await vi.advanceTimersByTimeAsync(600);
    expect(e.saved).toEqual(["x", "xy"]);
  });

  it("saves nothing while the form is not valid, and says so", async () => {
    const e = editor();
    e.type(null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(e.saved).toEqual([]);
    expect(e.states.at(-1)).toBe("invalid");
    e.type("fixed");
    await vi.advanceTimersByTimeAsync(600);
    expect(e.saved).toEqual(["fixed"]);
  });

  it("shows a failed save, keeps the change, and tries again on the next change or when asked", async () => {
    const e = editor({ failWith: "offline" });
    e.type("a");
    await vi.advanceTimersByTimeAsync(600);
    expect(e.states.at(-1)).toBe("error");
    expect(e.messages.at(-1)).toBe(NETWORK_MESSAGE);
    e.failWith(null);
    expect(await e.queue.retry()).toBe(true);
    expect(e.saved).toEqual(["a", "a"]);
    expect(e.states.at(-1)).toBe("saved");
  });

  it("reports the server's own message when a save is refused", async () => {
    const states: [SaveState, string | undefined][] = [];
    const queue = new AutosaveQueue<string>({
      delayMs: 600,
      savedKey: null,
      read: () => ({ value: "v", key: "v" }),
      save: async () => ({ ok: false, message: "This invoice has been issued." }),
      onState: (state, message) => states.push([state, message]),
    });
    queue.touch();
    await vi.advanceTimersByTimeAsync(600);
    expect(states.at(-1)).toEqual(["error", "This invoice has been issued."]);
  });

  it("flushes at once, before an action that needs the draft saved", async () => {
    const e = editor();
    e.type("draft");
    expect(await e.queue.flush()).toBe(true);
    expect(e.saved).toEqual(["draft"]);
    // Nothing more comes from the pause that was running.
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.saved).toEqual(["draft"]);
  });

  it("flush waits for a save on its way and then saves what changed", async () => {
    const e = editor();
    e.hold();
    e.type("one");
    await vi.advanceTimersByTimeAsync(600);
    e.type("two");
    const done = e.queue.flush();
    e.release();
    expect(await done).toBe(true);
    expect(e.saved).toEqual(["one", "two"]);
  });

  it("flush says no when the form is not valid or the save fails", async () => {
    const invalid = editor();
    invalid.type(null);
    expect(await invalid.queue.flush()).toBe(false);
    const failing = editor({ failWith: "x" });
    failing.type("a");
    expect(await failing.queue.flush()).toBe(false);
  });

  it("takes what the server has as saved, so it is not saved again", async () => {
    const e = editor();
    e.queue.markSaved("from the server");
    e.type("from the server");
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.saved).toEqual([]);
  });

  it("does nothing once stopped (the invoice was deleted or issued)", async () => {
    const e = editor();
    e.type("a");
    e.queue.stop();
    await vi.advanceTimersByTimeAsync(2000);
    e.type("b");
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.saved).toEqual([]);
    expect(await e.queue.flush()).toBe(true);
    expect(e.saved).toEqual([]);
  });
});
