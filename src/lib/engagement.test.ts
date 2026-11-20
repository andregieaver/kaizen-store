import { describe, expect, it } from "vitest";

import { engagementLevel } from "./engagement";

const now = new Date("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("a subscriber's engagement in words (M2.8)", () => {
  it("reads it from their latest press, and calls a new one new rather than asleep", () => {
    expect(engagementLevel(ago(400), ago(3), now)).toBe("active");
    expect(engagementLevel(ago(400), ago(60), now)).toBe("warm");
    expect(engagementLevel(ago(400), ago(150), now)).toBe("cooling");
    expect(engagementLevel(ago(10), null, now)).toBe("new");
    expect(engagementLevel(ago(400), null, now)).toBe("asleep");
  });

  it("calls a person the sunset paused paused, whatever their presses, until a press clears it", () => {
    expect(engagementLevel(ago(400), null, now, ago(1))).toBe("paused");
    expect(engagementLevel(ago(400), null, now, null)).toBe("asleep");
  });
});
