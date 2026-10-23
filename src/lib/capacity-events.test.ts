import { describe, expect, it } from "vitest";

import { parsePeak } from "./capacity-events";

const now = new Date("2026-10-23T10:00:00Z");

describe("parsePeak", () => {
  it("reads a sale of a few days", () => {
    expect(parsePeak({ starts: "2026-11-27", ends: "2026-11-30", expected: "very_busy", note: " Black Friday " }, now)).toEqual({
      startsAt: new Date("2026-11-27T00:00:00Z"),
      endsAt: new Date("2026-11-30T23:59:59Z"),
      expected: "very_busy",
      note: "Black Friday",
    });
  });

  it("refuses an end before the start, more than 14 days, a time already over and dates that are not dates", () => {
    expect(parsePeak({ starts: "2026-11-30", ends: "2026-11-27" }, now)).toBeNull();
    expect(parsePeak({ starts: "2026-11-01", ends: "2026-11-20" }, now)).toBeNull();
    expect(parsePeak({ starts: "2026-10-01", ends: "2026-10-02" }, now)).toBeNull();
    expect(parsePeak({ starts: "soon", ends: "2026-11-02" }, now)).toBeNull();
  });

  it("takes busy when how busy is not said, and cuts a long note", () => {
    const peak = parsePeak({ starts: "2026-11-01", ends: "2026-11-01", expected: "wild", note: "x".repeat(400) }, now)!;
    expect(peak.expected).toBe("busy");
    expect(peak.note).toHaveLength(300);
  });
});
