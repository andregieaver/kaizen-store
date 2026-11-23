import { describe, expect, it } from "vitest";

import { audienceNeeded, callBroadcastTest, testedOf, TEST_FLOOR } from "./broadcast-tests";

describe("a broadcast's split test (M2.5, D868)", () => {
  it("tests a share of the audience and needs the engine's floor in each version", () => {
    expect(TEST_FLOOR).toBe(200);
    expect(audienceNeeded(20)).toBe(2000);
    expect(audienceNeeded(50)).toBe(800);
    expect(testedOf(4210, 20)).toBe(842);
  });

  it("sends the rest the version more people pressed, when the difference is clear", () => {
    const call = callBroadcastTest({ sent: 421, pressed: 40, left: 2 }, { sent: 421, pressed: 80, left: 2 });
    expect(call).toMatchObject({ winner: "b", call: "b" });
    expect(call.diff).toBeCloseTo(40 / 421, 5);
    expect(callBroadcastTest({ sent: 421, pressed: 80, left: 2 }, { sent: 421, pressed: 40, left: 2 })).toMatchObject({ winner: "a", call: "a" });
  });

  it("sends A with no clear difference, too few readers or a broken split", () => {
    expect(callBroadcastTest({ sent: 421, pressed: 40, left: 1 }, { sent: 421, pressed: 44, left: 1 })).toMatchObject({ winner: "a", call: "even" });
    expect(callBroadcastTest({ sent: 150, pressed: 10, left: 0 }, { sent: 150, pressed: 60, left: 0 })).toMatchObject({ winner: "a", call: "few" });
    expect(callBroadcastTest({ sent: 900, pressed: 10, left: 0 }, { sent: 300, pressed: 90, left: 0 })).toMatchObject({ winner: "a", call: "broken" });
  });

  it("never lets a version that clearly loses readers win, whatever its presses", () => {
    expect(callBroadcastTest({ sent: 421, pressed: 40, left: 1 }, { sent: 421, pressed: 90, left: 40 })).toMatchObject({ winner: "a", call: "guard" });
    expect(callBroadcastTest({ sent: 421, pressed: 40, left: 40 }, { sent: 421, pressed: 42, left: 1 })).toMatchObject({ winner: "b", call: "guard" });
  });
});
