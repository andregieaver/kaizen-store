import { describe, expect, it } from "vitest";

import { ALERT_STATES, lowStockKey, lowStockLines, nextAlertState, stateFor, type AlertState } from "./stock-alerts";

describe("the state a figure and a level make", () => {
  it("is off without a level, low at or below it and ok above it", () => {
    expect(stateFor(null, 3)).toBe("off");
    expect(stateFor(5, 6)).toBe("ok");
    expect(stateFor(5, 5)).toBe("low");
    expect(stateFor(5, 4)).toBe("low");
    expect(stateFor(5, -2)).toBe("low");
    expect(stateFor(0, 0)).toBe("low");
    expect(stateFor(0, 1)).toBe("ok");
  });
});

describe("the transitions", () => {
  it("makes a crossing, to be told, from ok to low", () => {
    expect(nextAlertState("ok", 5, 5)).toEqual({ state: "low", crossedAt: "now", notifiedAt: "clear", stockAtCrossing: "set", crossing: true });
  });

  it("goes on being low, with the same crossing, as stock falls further", () => {
    for (const stock of [4, 3, 0, -1]) expect(nextAlertState("low", 5, stock)).toEqual({ state: "low", crossedAt: "keep", notifiedAt: "keep", stockAtCrossing: "keep", crossing: false });
  });

  it("sets a level on a variant that is already at or below it as already told, with no notice", () => {
    expect(nextAlertState("off", 5, 2)).toEqual({ state: "low", crossedAt: "now", notifiedAt: "now", stockAtCrossing: "set", crossing: false });
    expect(nextAlertState(null, 5, 5)).toEqual({ state: "low", crossedAt: "now", notifiedAt: "now", stockAtCrossing: "set", crossing: false });
  });

  it("re-arms when stock rises above the level, and a level set above the stock is just ok", () => {
    expect(nextAlertState("low", 5, 6)).toEqual({ state: "ok", crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false });
    expect(nextAlertState("off", 5, 20)).toEqual({ state: "ok", crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false });
    expect(nextAlertState(null, 5, 20).state).toBe("ok");
    expect(nextAlertState("ok", 5, 9)).toEqual({ state: "ok", crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false });
  });

  it("counts a level raised above the stock as a crossing at that moment, and lowering or clearing it re-arms or switches it off", () => {
    expect(nextAlertState("ok", 20, 10).crossing).toBe(true);
    expect(nextAlertState("low", 3, 10).state).toBe("ok");
    expect(nextAlertState("low", null, 10)).toEqual({ state: "off", crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false });
    expect(nextAlertState("ok", null, 10).state).toBe("off");
    expect(nextAlertState(null, null, 10).state).toBe("off");
  });

  it("tells the owners only of a crossing from ok, never from off or low, for every combination", () => {
    const levels = [null, 0, 5];
    const stocks = [-3, 0, 5, 6, 40];
    for (const prev of [null, ...ALERT_STATES] as (AlertState | null)[]) {
      for (const level of levels) {
        for (const stock of stocks) {
          const change = nextAlertState(prev, level, stock);
          expect(change.state).toBe(stateFor(level, stock));
          expect(change.crossing, `${prev} ${level} ${stock}`).toBe(change.state === "low" && prev === "ok");
          // The crossing's columns agree with the state: a low state has a crossing, anything else has none.
          if (change.state !== "low") expect([change.crossedAt, change.stockAtCrossing]).toEqual(["clear", "clear"]);
          else expect(change.crossedAt === "now" || change.crossedAt === "keep").toBe(true);
          // The owners are told once: only a new crossing from ok clears the told mark.
          expect(change.notifiedAt === "clear").toBe(change.crossing);
        }
      }
    }
  });

  it("sends one notice for a run of sales: ten units, a level of 5, sales one at a time", () => {
    let state: AlertState | null = null;
    let notices = 0;
    for (const stock of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
      const change = nextAlertState(state, 5, stock);
      if (change.crossing) notices += 1;
      state = change.state;
    }
    expect(notices).toBe(1);
    // Stock above the level and a second run of sales is a second notice.
    for (const stock of [12, 11, 6, 5, 4]) {
      const change = nextAlertState(state, 5, stock);
      if (change.crossing) notices += 1;
      state = change.state;
    }
    expect(notices).toBe(2);
  });
});

describe("the email", () => {
  it("is keyed by the store and the newest crossing, so a retry is the same email", () => {
    const crossings = [{ crossedAt: "2026-10-06T08:00:00.000Z" }, { crossedAt: new Date("2026-10-06T09:30:00.000Z") }];
    const key = lowStockKey("store-1", crossings);
    expect(key).toBe(`stock.low:store-1:${Date.parse("2026-10-06T09:30:00.000Z")}`);
    expect(lowStockKey("store-1", [...crossings].reverse())).toBe(key);
    expect(lowStockKey("store-2", crossings)).not.toBe(key);
    expect(lowStockKey("store-1", [...crossings, { crossedAt: "2026-10-06T10:00:00.000Z" }])).not.toBe(key);
  });

  it("lists at most the lines it is given room for, and says how many more", () => {
    const all = Array.from({ length: 53 }, (_, i) => i);
    expect(lowStockLines(all, 50)).toEqual({ shown: all.slice(0, 50), more: 3 });
    expect(lowStockLines([1, 2], 50)).toEqual({ shown: [1, 2], more: 0 });
    expect(lowStockLines([], 50)).toEqual({ shown: [], more: 0 });
  });
});
