import { describe, expect, it } from "vitest";

import { shiftMonth, usageMonth } from "./usage-month";

describe("usageMonth", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  it("reads a month from the address, never one after now", () => {
    expect(usageMonth("2026-09", now)).toBe("2026-09");
    expect(usageMonth("2027-01", now)).toBe("2026-10");
    expect(usageMonth("nonsense", now)).toBe("2026-10");
    expect(usageMonth(undefined, now)).toBe("2026-10");
  });
  it("steps across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
