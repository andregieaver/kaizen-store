import { describe, expect, it } from "vitest";

import { PERIOD_LABELS, recurringPayload, scheduleLabel, scheduleSummary, servicePeriod, type RecurringFormValues } from "./work-recurring-ui";

const CLIENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001";

const values = (over: Partial<RecurringFormValues> = {}): RecurringFormValues => ({
  name: "Retainer",
  description: "",
  unit: "unit",
  quantity: "1",
  price: "9 500,50",
  discount: "0",
  vatCategory: "standard",
  currency: "NOK",
  interval: "1",
  period: "month",
  startDate: "2026-09-15",
  endDate: "",
  paymentDays: "",
  autoIssue: false,
  ...over,
});

describe("the period an invoice covers", () => {
  it("runs from the period to the day before the next one", () => {
    expect(servicePeriod({ interval: 1, period: "month", startDate: "2026-09-15" }, "2026-09-15")).toEqual({
      from: "2026-09-15",
      to: "2026-10-14",
    });
    expect(servicePeriod({ interval: 2, period: "week", startDate: "2026-09-01" }, "2026-09-15")).toEqual({
      from: "2026-09-15",
      to: "2026-09-28",
    });
    expect(servicePeriod({ interval: 1, period: "year", startDate: "2026-01-01" }, "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("follows a month's end without drifting", () => {
    const rule = { interval: 1, period: "month", startDate: "2026-01-31" } as const;
    expect(servicePeriod(rule, "2026-01-31").to).toBe("2026-02-27");
    expect(servicePeriod(rule, "2026-02-28").to).toBe("2026-03-30");
  });
});

describe("the words for a schedule", () => {
  it("says every month, or every few weeks", () => {
    expect(scheduleLabel(1, "month")).toBe("Every month");
    expect(scheduleLabel(3, "month")).toBe("Every 3 months");
    expect(scheduleLabel(2, "week")).toBe("Every 2 weeks");
    expect(Object.keys(PERIOD_LABELS)).toEqual(["week", "month", "year"]);
  });

  it("adds where it starts and ends", () => {
    const text = scheduleSummary({ recurrenceInterval: 1, recurrencePeriod: "month", startDate: "2026-09-15", endDate: null }, "en-GB");
    expect(text).toBe("Every month from 15/09/2026");
    expect(
      scheduleSummary({ recurrenceInterval: 1, recurrencePeriod: "year", startDate: "2026-09-15", endDate: "2028-09-15" }, "en-GB"),
    ).toBe("Every year from 15/09/2026 until 15/09/2028");
  });
});

describe("the form", () => {
  it("becomes the input the server checks, with the amounts as integers", () => {
    const read = recurringPayload(values({ quantity: "1,5", discount: "12,5" }), CLIENT);
    expect(read).toMatchObject({
      ok: true,
      input: {
        clientId: CLIENT,
        name: "Retainer",
        quantityHundredths: 150,
        unitPriceMinor: 950050,
        discountBp: 1250,
        recurrenceInterval: 1,
        recurrencePeriod: "month",
        startDate: "2026-09-15",
        autoIssue: false,
        isActive: true,
      },
    });
  });

  it("reads hours as a time too", () => {
    const read = recurringPayload(values({ unit: "hour", quantity: "1h30" }), CLIENT);
    expect(read).toMatchObject({ ok: true, input: { unit: "hour", quantityHundredths: 150 } });
  });

  it("says what is wrong by field", () => {
    const read = recurringPayload(
      values({ name: "", price: "", quantity: "many", discount: "150", startDate: "", paymentDays: "x", endDate: "2020-01-01" }),
      CLIENT,
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(Object.keys(read.problems.fields).sort()).toEqual(["discount", "name", "paymentDays", "price", "quantity", "startDate"]);
    expect(read.problems.fields.price).toBe("Enter the price without VAT.");
  });

  it("refuses an end before the start", () => {
    const read = recurringPayload(values({ endDate: "2026-09-01" }), CLIENT);
    expect(read.ok).toBe(false);
  });

  it("keeps a paused template paused when it is saved", () => {
    expect(recurringPayload(values(), CLIENT, false)).toMatchObject({ ok: true, input: { isActive: false } });
  });
});
