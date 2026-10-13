import { describe, expect, it } from "vitest";

import { defaultHours, type OpeningHours } from "./opening-hours";
import { deskAvailability, localClock, withinHours } from "./support-hours";

const oslo = "Europe/Oslo";
// Tuesday 14 October 2025 at 10:00 in Oslo (summer time ended 26 October: UTC+2).
const tuesdayTen = new Date("2025-10-14T08:00:00Z");
const seen = (secondsAgo: number) => new Date(tuesdayTen.getTime() - secondsAgo * 1000);

describe("whether a desk can answer now (D216, 2.3)", () => {
  it("reads the clock in the desk's time zone", () => {
    expect(localClock(tuesdayTen, oslo)).toEqual({ date: "2025-10-14", time: "10:00" });
  });

  it("is open inside the hours, and always without hours", () => {
    expect(withinHours(null, tuesdayTen, oslo)).toBe(true);
    expect(withinHours(defaultHours(), tuesdayTen, oslo)).toBe(true);
    // Saturday is closed in the default week.
    expect(withinHours(defaultHours(), new Date("2025-10-18T08:00:00Z"), oslo)).toBe(false);
    // 17:00 is closing time.
    expect(withinHours(defaultHours(), new Date("2025-10-14T15:00:00Z"), oslo)).toBe(false);
  });

  it("follows hours that run past midnight", () => {
    const late: OpeningHours = { ...defaultHours(), week: { ...defaultHours().week, mon: { open: "20:00", close: "02:00" } } };
    // Tuesday 01:00 in Oslo is still Monday's evening.
    expect(withinHours(late, new Date("2025-10-13T23:00:00Z"), oslo)).toBe(true);
    expect(withinHours(late, new Date("2025-10-14T01:00:00Z"), oslo)).toBe(false);
  });

  it("needs an agent online: switched on and seen in the last minute", () => {
    const base = { now: tuesdayTen, hours: defaultHours(), timeZone: oslo };
    expect(deskAvailability({ ...base, agents: [{ status: "online", lastSeenAt: seen(30) }] })).toEqual({ open: true, online: 1, reason: "online" });
    expect(deskAvailability({ ...base, agents: [{ status: "online", lastSeenAt: seen(90) }] })).toEqual({ open: false, online: 0, reason: "no_agents" });
    expect(deskAvailability({ ...base, agents: [{ status: "away", lastSeenAt: seen(5) }] })).toEqual({ open: false, online: 0, reason: "no_agents" });
    expect(deskAvailability({ ...base, now: new Date("2025-10-18T08:00:00Z"), agents: [{ status: "online", lastSeenAt: new Date("2025-10-18T07:59:50Z") }] }).reason).toBe("closed_hours");
  });
});
