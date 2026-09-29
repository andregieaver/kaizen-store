import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAYMENT_DAYS,
  addCalendarDays,
  addMonthsClamped,
  clampPaymentDays,
  daysBetween,
  daysOverdue,
  dayIn,
  dayRange,
  dueOn,
  dueState,
  formatDay,
  isDay,
  isOverdue,
  isTimeZone,
  issueDateProblem,
  monthOf,
  noonOf,
  parseDay,
  resolvePaymentDays,
  startOfDay,
  startOfMonth,
  tentativeDueOn,
  todayIn,
} from "./work-dates";

const OSLO = "Europe/Oslo";

describe("payment terms (Life's payment-due-days tests)", () => {
  it("prefers the invoice's override, then the client's, then the default", () => {
    expect(resolvePaymentDays({ invoice: 21, client: 7 })).toBe(21);
    expect(resolvePaymentDays({ invoice: null, client: 7 })).toBe(7);
    expect(resolvePaymentDays({})).toBe(DEFAULT_PAYMENT_DAYS);
    expect(DEFAULT_PAYMENT_DAYS).toBe(14);
  });

  it("puts the store's default between the client's and 14", () => {
    expect(resolvePaymentDays({ invoice: null, client: null, store: 30 })).toBe(30);
    expect(resolvePaymentDays({ client: 7, store: 30 })).toBe(7);
    expect(resolvePaymentDays({ invoice: Number.NaN, client: undefined, store: null })).toBe(14);
  });

  it("clamps to 1-90 days", () => {
    expect(clampPaymentDays(0)).toBe(1);
    expect(clampPaymentDays(200)).toBe(90);
    expect(resolvePaymentDays({ invoice: 200 })).toBe(90);
    expect(resolvePaymentDays({ client: -5 })).toBe(1);
    expect(clampPaymentDays(14.6)).toBe(15);
  });

  it("adds days in the calendar", () => {
    expect(dueOn("2026-04-02", 14)).toBe("2026-04-16");
    expect(tentativeDueOn("2026-04-02", 14)).toBe("2026-04-16");
    expect(dueOn("2026-01-25", 14)).toBe("2026-02-08");
    expect(dueOn("2026-02-20", 14)).toBe("2026-03-06");
    expect(dueOn("2028-02-20", 14)).toBe("2028-03-05"); // a leap year
    expect(dueOn("2026-12-25", 14)).toBe("2027-01-08");
    expect(dueOn("2026-03-20", 14)).toBe("2026-04-03"); // over the change to summer time
    expect(dueOn("2026-10-20", 14)).toBe("2026-11-03"); // and back
  });

  it("refuses something that is not a day", () => {
    expect(() => dueOn("2026-02-30", 14)).toThrow(RangeError);
    expect(() => dueOn("28.09.2026", 14)).toThrow(RangeError);
  });
});

describe("calendar days", () => {
  it("reads only real days", () => {
    expect(parseDay("2026-09-29")).toEqual({ year: 2026, month: 9, day: 29 });
    expect(parseDay("2028-02-29")).not.toBeNull();
    expect(parseDay("2026-02-29")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-13-01")).toBeNull();
    expect(parseDay("2026-2-3")).toBeNull();
    expect(parseDay("2026-09-29T10:00:00Z")).toBeNull();
    expect(isDay("2026-09-29")).toBe(true);
    expect(isDay("")).toBe(false);
  });

  it("counts days between, over daylight saving", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-09-29", "2026-09-20")).toBe(-9);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("adds calendar days", () => {
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("adds months, clamping to the month's last day and never drifting", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", -13)).toBe("2024-12-31");
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2028-02-29", 48)).toBe("2032-02-29");
    expect(addMonthsClamped("2026-05-15", 0)).toBe("2026-05-15");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("finds the month", () => {
    expect(startOfMonth("2026-09-29")).toBe("2026-09-01");
    expect(monthOf("2026-09-29")).toBe("2026-09");
  });

  it("shows a day in the locale, the same wherever the viewer is", () => {
    expect(formatDay("2026-09-28", "nb-NO")).toBe("28.09.2026");
    expect(formatDay("2026-09-28", "en-GB")).toBe("28/09/2026");
  });
});

describe("the store's time zone", () => {
  it("knows time zones", () => {
    expect(isTimeZone(OSLO)).toBe(true);
    expect(isTimeZone("Not/AZone")).toBe(false);
    expect(() => dayIn(0, "Not/AZone")).toThrow();
  });

  it("puts a moment on the store's day, not the UTC day, around Oslo midnight", () => {
    // 23:30 UTC on 28 Sep is 01:30 on the 29th in Oslo (summer time, UTC+2)
    expect(dayIn("2026-09-28T23:30:00Z", OSLO)).toBe("2026-09-29");
    expect(dayIn("2026-09-28T21:59:59Z", OSLO)).toBe("2026-09-28");
    expect(dayIn("2026-09-28T22:00:00Z", OSLO)).toBe("2026-09-29");
    // winter time is UTC+1
    expect(dayIn("2026-01-15T22:59:59Z", OSLO)).toBe("2026-01-15");
    expect(dayIn("2026-01-15T23:00:00Z", OSLO)).toBe("2026-01-16");
    expect(todayIn(OSLO, new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(dayIn(Date.parse("2026-06-30T22:30:00Z"), "UTC")).toBe("2026-06-30");
  });

  it("gets the days of the clock changes right", () => {
    // spring forward: 29 Mar 2026 at 01:00 UTC (02:00 -> 03:00 in Oslo)
    expect(dayIn("2026-03-28T22:59:59Z", OSLO)).toBe("2026-03-28");
    expect(dayIn("2026-03-28T23:00:00Z", OSLO)).toBe("2026-03-29");
    expect(dayIn("2026-03-29T21:59:59Z", OSLO)).toBe("2026-03-29");
    expect(dayIn("2026-03-29T22:00:00Z", OSLO)).toBe("2026-03-30");
    // fall back: 25 Oct 2026 at 01:00 UTC (03:00 -> 02:00)
    expect(dayIn("2026-10-24T22:00:00Z", OSLO)).toBe("2026-10-25");
    expect(dayIn("2026-10-25T22:59:59Z", OSLO)).toBe("2026-10-25");
    expect(dayIn("2026-10-25T23:00:00Z", OSLO)).toBe("2026-10-26");
  });

  it("gives a day's range in instants: 23 hours in spring, 25 in autumn", () => {
    const spring = dayRange("2026-03-29", OSLO);
    expect(spring.from.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(spring.to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const autumn = dayRange("2026-10-25", OSLO);
    expect(autumn.from.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(autumn.to.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((autumn.to.getTime() - autumn.from.getTime()) / 3_600_000).toBe(25);
    const normal = dayRange("2026-06-10", OSLO);
    expect((normal.to.getTime() - normal.from.getTime()) / 3_600_000).toBe(24);
    expect(startOfDay("2026-06-10", OSLO).toISOString()).toBe("2026-06-09T22:00:00.000Z");
  });

  it("every moment of a day's range is on that day, and the next instant is not", () => {
    for (const day of ["2026-03-29", "2026-10-25", "2026-06-10"]) {
      const { from, to } = dayRange(day, OSLO);
      expect(dayIn(from, OSLO)).toBe(day);
      expect(dayIn(to.getTime() - 1, OSLO)).toBe(day);
      expect(dayIn(to, OSLO)).toBe(addCalendarDays(day, 1));
      expect(dayIn(from.getTime() - 1, OSLO)).toBe(addCalendarDays(day, -1));
    }
  });

  it("puts a payment at noon in the store's zone, so it stays on its day", () => {
    expect(noonOf("2026-01-15", OSLO).toISOString()).toBe("2026-01-15T11:00:00.000Z");
    expect(noonOf("2026-06-15", OSLO).toISOString()).toBe("2026-06-15T10:00:00.000Z");
    expect(noonOf("2026-03-29", OSLO).toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(dayIn(noonOf("2026-03-29", OSLO), OSLO)).toBe("2026-03-29");
    expect(dayIn(noonOf("2026-03-29", OSLO), "UTC")).toBe("2026-03-29");
  });

  it("works for other zones", () => {
    expect(dayIn("2026-09-29T03:00:00Z", "America/New_York")).toBe("2026-09-28");
    expect(dayIn("2026-09-28T23:00:00Z", "Asia/Tokyo")).toBe("2026-09-29");
  });
});

describe("overdue", () => {
  const sent = (dueDay: string | null) => ({ status: "sent", dueOn: dueDay });

  it("is a sent invoice past its due date; due today is not overdue", () => {
    expect(isOverdue(sent("2026-09-28"), "2026-09-29")).toBe(true);
    expect(isOverdue(sent("2026-09-29"), "2026-09-29")).toBe(false);
    expect(isOverdue(sent("2026-09-30"), "2026-09-29")).toBe(false);
    expect(isOverdue(sent(null), "2026-09-29")).toBe(false);
  });

  it("is never true for a draft, a paid or a voided invoice", () => {
    for (const status of ["draft", "paid", "void"]) {
      expect(isOverdue({ status, dueOn: "2020-01-01" }, "2026-09-29")).toBe(false);
    }
  });

  it("counts the days late by the store's day", () => {
    expect(daysOverdue(sent("2026-09-20"), "2026-09-29")).toBe(9);
    expect(daysOverdue(sent("2026-09-29"), "2026-09-29")).toBe(0);
    expect(daysOverdue({ status: "paid", dueOn: "2026-09-01" }, "2026-09-29")).toBe(0);
    // an invoice due on the 29th is overdue from the store's 30th, even when it is still the 29th in UTC
    const now = new Date("2026-09-29T22:30:00Z");
    expect(isOverdue(sent("2026-09-29"), todayIn(OSLO, now))).toBe(true);
    expect(isOverdue(sent("2026-09-29"), todayIn("UTC", now))).toBe(false);
  });

  it("sorts sent invoices into the overview's buckets", () => {
    expect(dueState("2026-09-28", "2026-09-29")).toBe("overdue");
    expect(dueState("2026-09-29", "2026-09-29")).toBe("due_soon");
    expect(dueState("2026-10-06", "2026-09-29")).toBe("due_soon");
    expect(dueState("2026-10-07", "2026-09-29")).toBe("not_due");
  });
});

describe("the issue date", () => {
  const base = { today: "2026-09-29", backdateDays: 3, previousDocumentDate: "2026-09-25" };
  it("accepts today and a recent day", () => {
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-29" })).toBeNull();
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-26" })).toBeNull();
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-25", previousDocumentDate: "2026-09-25" })).toBe("too_old");
  });

  it("refuses a bad day, a future day, a day too far back and a day before the previous document", () => {
    expect(issueDateProblem({ ...base, issuedOn: "2026-02-30" })).toBe("invalid");
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-30" })).toBe("future");
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-20", previousDocumentDate: null })).toBe("too_old");
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-27", previousDocumentDate: "2026-09-28" })).toBe(
      "before_previous",
    );
    expect(issueDateProblem({ ...base, issuedOn: "2026-09-28", backdateDays: 0 })).toBe("too_old");
    expect(
      issueDateProblem({ ...base, issuedOn: "2026-09-29", backdateDays: 0, previousDocumentDate: null }),
    ).toBeNull();
  });
});
