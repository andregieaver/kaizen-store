import { describe, expect, it } from "vitest";

import { emptyHistory, GROUP_MS, HISTORY_MAX, historyKey, record, redo, undo } from "./edit-history";

describe("the page builder's undo and redo (D305)", () => {
  it("takes back each change and puts it back again", () => {
    let h = emptyHistory<string>();
    h = record(h, "a", "row", 0);
    h = record(h, "b", "block", 5000);
    // The editor now shows "c".
    const back = undo(h, "c")!;
    expect(back.value).toBe("b");
    const back2 = undo(back.history, back.value)!;
    expect(back2.value).toBe("a");
    expect(undo(back2.history, back2.value)).toBeNull();
    const forward = redo(back2.history, back2.value)!;
    expect(forward.value).toBe("b");
    expect(redo(forward.history, forward.value)!.value).toBe("c");
  });

  it("makes one step of letters typed close together, and a new one after a pause or another kind of change", () => {
    let h = emptyHistory<string>();
    h = record(h, "", "text:t1", 0);
    h = record(h, "H", "text:t1", 100);
    h = record(h, "He", "text:t1", 100 + GROUP_MS);
    expect(h.past).toEqual([""]);
    h = record(h, "Hei", "text:t1", 200 + 2 * GROUP_MS);
    expect(h.past).toEqual(["", "Hei"]);
    h = record(h, "Hei!", "text:t2", 250 + 2 * GROUP_MS);
    expect(h.past).toEqual(["", "Hei", "Hei!"]);
  });

  it("ends what could be redone with a new change, and never groups across an undo", () => {
    let h = emptyHistory<number>();
    h = record(h, 1, "k", 0);
    const back = undo(h, 2)!;
    expect(back.history.future).toEqual([2]);
    const after = record(back.history, 1, "k", 10);
    expect(after.future).toEqual([]);
    expect(after.past).toEqual([1]);
  });

  it("keeps at most a hundred steps", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_MAX + 20; i++) h = record(h, i, `k${i}`, i * 10_000);
    expect(h.past).toHaveLength(HISTORY_MAX);
    expect(h.past[0]).toBe(20);
  });

  it("reads Undo and Redo from the keys on Windows, Linux and Mac", () => {
    const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
      historyKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(key("z", { ctrlKey: true })).toBe("undo");
    expect(key("z", { metaKey: true })).toBe("undo");
    expect(key("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(key("y", { ctrlKey: true })).toBe("redo");
    expect(key("z")).toBeNull();
    expect(key("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("s", { ctrlKey: true })).toBeNull();
  });
});
