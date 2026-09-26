import { describe, expect, it } from "vitest";

import { addDays, bookingSpan, dateBookable, slotsOn, zonedDate, zonedTime, type AppointmentRules } from "./booking-slots";
import { defaultHours } from "./opening-hours";

const OSLO = "Europe/Oslo";
const rules: AppointmentRules = {
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  stepMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
};
const at = (iso: string) => Date.parse(iso);
const times = (slots: { startsAt: string }[]) => slots.map((s) => s.startsAt.slice(11, 16));

describe("time zones", () => {
  it("turns wall-clock times into instants, across the change of clocks", () => {
    expect(new Date(zonedTime("2026-10-05", "09:00", OSLO)).toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(new Date(zonedTime("2026-12-07", "09:00", OSLO)).toISOString()).toBe("2026-12-07T08:00:00.000Z");
    // Summer time ends on 25 October 2026 at 03:00: the morning after is an hour later in UTC.
    expect(new Date(zonedTime("2026-10-25", "09:00", OSLO)).toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(zonedDate(at("2026-10-04T22:30:00Z"), OSLO)).toBe("2026-10-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("slots", () => {
  // Monday 5 October 2026, 08:00 in Oslo.
  const now = at("2026-10-05T06:00:00Z");
  const kari = { id: "kari", hours: defaultHours(), capacity: 1, busy: [] };

  it("offers every step from opening until the appointment no longer fits, after the notice", () => {
    const slots = slotsOn("2026-10-05", OSLO, rules, [kari], now);
    // Opens 09:00 (07:00 UTC), notice to 09:00, last start 16:00 to end by 17:00.
    expect(times(slots)).toEqual(["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"]);
    expect(slots[0]).toMatchObject({ endsAt: "2026-10-05T08:00:00.000Z", resourceIds: ["kari"] });
    // Closed at weekends, and not beyond how far ahead.
    expect(slotsOn("2026-10-10", OSLO, rules, [kari], now)).toEqual([]);
    expect(dateBookable(addDays("2026-10-05", 31), rules, OSLO, now)).toBe(false);
    expect(dateBookable("2026-10-04", rules, OSLO, now)).toBe(false);
  });

  it("leaves out times that would overlap a booking with its buffers, unless there is room for more", () => {
    // Booked 10:00–11:00 Oslo, with 15 minutes after.
    const span = bookingSpan(zonedTime("2026-10-05", "10:00", OSLO), rules);
    const busy = [{ from: span.blockedFrom, to: span.blockedTo }];
    const slots = slotsOn("2026-10-05", OSLO, rules, [{ ...kari, busy }], now);
    // 09:00 and 09:30 would run into it with their own buffer after, 10:00 to 11:00 overlap it and
    // its buffer; 11:30 Oslo (09:30 UTC) is the first free.
    expect(times(slots).slice(0, 3)).toEqual(["09:30", "10:00", "10:30"]);
    // With a second staff member free, every time is offered, by whoever is free.
    const ola = { ...kari, id: "ola" };
    const both = slotsOn("2026-10-05", OSLO, rules, [{ ...kari, busy }, ola], now);
    expect(both.find((s) => s.startsAt === "2026-10-05T08:00:00.000Z")?.resourceIds).toEqual(["ola"]);
    expect(both.find((s) => s.startsAt === "2026-10-05T09:30:00.000Z")?.resourceIds).toEqual(["kari", "ola"]);
  });
});
