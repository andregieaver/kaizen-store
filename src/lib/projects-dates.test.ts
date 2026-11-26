import { describe, expect, it } from "vitest";

import { dueState, instantOf, whenFields } from "./projects-dates";

describe("an item's dates in the store's zone (D903)", () => {
  it("keeps a day alone as a whole day at noon, and a day with a time as that time", () => {
    expect(instantOf("2026-12-01", "", "Europe/Oslo")).toEqual({ at: "2026-12-01T11:00:00.000Z", allDay: true });
    expect(instantOf("2026-07-01", "09:30", "Europe/Oslo")).toEqual({ at: "2026-07-01T07:30:00.000Z", allDay: false });
    expect(instantOf("", "09:30", "Europe/Oslo")).toEqual({ at: null, allDay: null });
  });

  it("gives back the fields it was made from", () => {
    expect(whenFields("2026-07-01T07:30:00.000Z", false, "Europe/Oslo")).toEqual({ day: "2026-07-01", time: "09:30" });
    expect(whenFields("2026-12-01T11:00:00.000Z", true, "Europe/Helsinki")).toEqual({ day: "2026-12-01", time: "" });
    expect(whenFields(null, null, "Europe/Oslo")).toEqual({ day: "", time: "" });
  });

  it("says late, today or later on the store's day", () => {
    const now = new Date("2026-11-25T15:00:00Z");
    expect(dueState("2026-11-24T11:00:00Z", true, now, "Europe/Oslo")).toBe("late");
    expect(dueState("2026-11-25T11:00:00Z", true, now, "Europe/Oslo")).toBe("today");
    expect(dueState("2026-11-25T10:00:00Z", false, now, "Europe/Oslo")).toBe("late");
    expect(dueState("2026-11-26T11:00:00Z", true, now, "Europe/Oslo")).toBe("later");
  });
});
