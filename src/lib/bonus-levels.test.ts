import { describe, expect, it } from "vitest";

import { earnBpsFor, levelFor, levelsProblem, nextLevel, readLevels } from "./bonus-levels";

const levels = [
  { name: "Silver", fromMinor: 200_000, earnBps: 600 },
  { name: "Gold", fromMinor: 500_000, earnBps: 750 },
];

describe("loyalty levels (D392)", () => {
  it("gives the highest level reached, never a sum, and the program's own rate below the first", () => {
    expect(levelFor(levels, 199_999)).toBeNull();
    expect(earnBpsFor(500, levels, 199_999)).toBe(500);
    expect(levelFor(levels, 200_000)?.name).toBe("Silver");
    expect(earnBpsFor(500, levels, 900_000)).toBe(750);
  });

  it("says the next level and what more it needs, and nothing at the top", () => {
    expect(nextLevel(levels, 150_000)).toEqual({ level: levels[0], remainingMinor: 50_000 });
    expect(nextLevel(levels, 300_000)).toEqual({ level: levels[1], remainingMinor: 200_000 });
    expect(nextLevel(levels, 500_000)).toBeNull();
    expect(nextLevel([], 0)).toBeNull();
  });

  it("refuses levels that are not steps up, too many, unnamed or above the ceiling", () => {
    expect(levelsProblem(levels, 500, 5000)).toBeNull();
    expect(levelsProblem([...levels].reverse(), 500, 5000)).toBe("order");
    expect(levelsProblem([{ name: "Silver", fromMinor: 100, earnBps: 400 }], 500, 5000)).toBe("rate_order");
    expect(levelsProblem([{ name: " ", fromMinor: 100, earnBps: 600 }], 500, 5000)).toBe("name");
    expect(levelsProblem([{ name: "A", fromMinor: 100, earnBps: 6000 }], 500, 5000)).toBe("rate");
    expect(levelsProblem(Array.from({ length: 5 }, (_, i) => ({ name: `L${i}`, fromMinor: (i + 1) * 100, earnBps: 600 + i })), 500, 5000)).toBe("too_many");
  });

  it("reads what the database keeps without trusting its shape", () => {
    expect(readLevels(null)).toEqual([]);
    expect(readLevels([{ name: "Gold", fromMinor: 1, earnBps: 2 }, { name: 3 }, "x"])).toEqual([{ name: "Gold", fromMinor: 1, earnBps: 2 }]);
  });
});
