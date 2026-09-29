import { describe, expect, it } from "vitest";

import {
  GENERATE_LOOKBACK_DAYS,
  isOccurrenceDay,
  listOccurrenceDates,
  nextOccurrences,
  openPeriods,
  planRecurring,
  recurrenceWindow,
  withSkippedPeriod,
  type ExistingInstance,
  type RecurrenceRule,
  type RecurringPlan,
  type RecurringTemplate,
} from "./work-recurrence";

const rule = (o: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  interval: 1,
  period: "month",
  startDate: "2026-01-15",
  ...o,
});

describe("listOccurrenceDates (Life's schedule, unchanged in behaviour)", () => {
  it("clamps a monthly rule to the month's last day without drifting", () => {
    expect(listOccurrenceDates(rule({ startDate: "2026-01-31" }), "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("uses 29 February in a leap year", () => {
    expect(listOccurrenceDates(rule({ startDate: "2028-01-31" }), "2028-02-01", "2028-03-01")).toEqual(["2028-02-29"]);
    expect(listOccurrenceDates(rule({ startDate: "2028-01-30" }), "2028-02-01", "2028-02-28")).toEqual([]);
  });

  it("steps by the interval", () => {
    expect(listOccurrenceDates(rule({ interval: 3, startDate: "2026-11-30" }), "2026-11-01", "2027-12-31")).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
      "2027-08-30",
      "2027-11-30",
    ]);
  });

  it("counts weeks from the start, before and inside the range", () => {
    const biweekly = rule({ period: "week", interval: 2, startDate: "2026-09-07" });
    expect(listOccurrenceDates(biweekly, "2026-09-01", "2026-10-10")).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-10-05",
    ]);
    expect(listOccurrenceDates(biweekly, "2026-09-10", "2026-10-31")).toEqual([
      "2026-09-21",
      "2026-10-05",
      "2026-10-19",
    ]);
    expect(listOccurrenceDates(biweekly, "2026-01-01", "2026-09-06")).toEqual([]);
    expect(listOccurrenceDates(biweekly, "2026-09-08", "2026-09-20")).toEqual([]);
    expect(listOccurrenceDates(rule({ period: "week", startDate: "2026-09-07" }), "2026-09-07", "2026-09-07")).toEqual([
      "2026-09-07",
    ]);
  });

  it("keeps a weekly rule on its weekday across the clock changes", () => {
    const weekly = rule({ period: "week", startDate: "2026-03-23" });
    expect(listOccurrenceDates(weekly, "2026-03-23", "2026-04-13")).toEqual([
      "2026-03-23",
      "2026-03-30",
      "2026-04-06",
      "2026-04-13",
    ]);
  });

  it("repeats yearly from the start, so a 29 February start returns to the 29th in leap years", () => {
    const yearly = rule({ period: "year", startDate: "2028-02-29" });
    expect(listOccurrenceDates(yearly, "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
    expect(
      listOccurrenceDates(rule({ period: "year", interval: 4, startDate: "2026-06-01" }), "2026-01-01", "2040-01-01"),
    ).toEqual(["2026-06-01", "2030-06-01", "2034-06-01", "2038-06-01"]);
  });

  it("does not list anything before the start, and includes both ends of the range", () => {
    expect(listOccurrenceDates(rule(), "2025-01-01", "2026-01-14")).toEqual([]);
    expect(listOccurrenceDates(rule(), "2026-02-15", "2026-03-15")).toEqual(["2026-02-15", "2026-03-15"]);
  });

  it("gives nothing for an invalid start or range", () => {
    expect(listOccurrenceDates(rule({ startDate: "2026-02-30" }), "2026-01-01", "2026-12-31")).toEqual([]);
    expect(listOccurrenceDates(rule(), "nope", "2026-12-31")).toEqual([]);
  });

  it("stops counting after 240 monthly and 40 yearly steps, as Life did", () => {
    const monthly = listOccurrenceDates(rule({ startDate: "2000-01-01" }), "2000-01-01", "2026-12-31");
    expect(monthly).toHaveLength(240);
    expect(monthly.at(-1)).toBe("2019-12-01");
    const yearly = listOccurrenceDates(rule({ period: "year", startDate: "1970-01-01" }), "1970-01-01", "2100-01-01");
    expect(yearly).toHaveLength(40);
  });

  it("says whether a day is an occurrence", () => {
    expect(isOccurrenceDay(rule({ startDate: "2026-01-31" }), "2026-02-28")).toBe(true);
    expect(isOccurrenceDay(rule({ startDate: "2026-01-31" }), "2026-02-27")).toBe(false);
  });
});

describe("the generation window", () => {
  it("starts on the first of the month 24 months back and ends today", () => {
    expect(recurrenceWindow("2026-09-29")).toEqual({ from: "2024-09-01", to: "2026-09-29" });
    expect(recurrenceWindow("2026-01-01")).toEqual({ from: "2024-01-01", to: "2026-01-01" });
  });
});

describe("planning what the recurring job does", () => {
  const TODAY = "2026-09-29";
  const template = (o: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
    id: "t1",
    isActive: true,
    autoIssue: false,
    rule: rule({ startDate: "2026-01-15" }),
    endDate: null,
    skippedPeriods: [],
    ...o,
  });
  const inst = (period: string, status: ExistingInstance["status"], templateId = "t1"): ExistingInstance => ({
    templateId,
    period,
    status,
    invoiceId: `inv-${templateId}-${period}`,
  });
  const plan = (templates: RecurringTemplate[], existing: ExistingInstance[] = [], today = TODAY) =>
    planRecurring({ templates, existing, today });

  it("generates only the recent period as a draft, and issues nothing when auto-issue is off", () => {
    // due 15 Jan .. 15 Sep; only 15 Sep is within 40 days (cutoff 20 Aug)
    expect(plan([template()])).toEqual({
      generate: [{ templateId: "t1", period: "2026-09-15", issueAfter: false }],
      issue: [],
      issueOn: TODAY,
    });
  });

  it("uses a 40 day look-back that includes its first day", () => {
    expect(GENERATE_LOOKBACK_DAYS).toBe(40);
    // cutoff is 2026-08-20
    const onCutoff = plan([template({ rule: rule({ startDate: "2026-08-20" }) })]);
    expect(onCutoff.generate.map((g) => g.period)).toEqual(["2026-08-20", "2026-09-20"]);
    const dayBefore = plan([template({ rule: rule({ startDate: "2026-08-19" }) })]);
    expect(dayBefore.generate.map((g) => g.period)).toEqual(["2026-09-19"]);
  });

  it("does not bill years at once for a template made long ago", () => {
    const old = plan([template({ rule: rule({ startDate: "2020-01-01" }) })]);
    expect(old.generate.map((g) => g.period)).toEqual(["2026-09-01"]);
  });

  it("marks new drafts for issue, and issues existing drafts of any age, only with auto-issue on", () => {
    const auto = template({ autoIssue: true });
    const p = plan([auto], [inst("2026-03-15", "draft"), inst("2026-08-15", "draft")]);
    expect(p.generate).toEqual([{ templateId: "t1", period: "2026-09-15", issueAfter: true }]);
    expect(p.issue).toEqual([
      { templateId: "t1", period: "2026-03-15", invoiceId: "inv-t1-2026-03-15" },
      { templateId: "t1", period: "2026-08-15", invoiceId: "inv-t1-2026-08-15" },
    ]);
    const manual = plan([template()], [inst("2026-03-15", "draft")]);
    expect(manual.issue).toEqual([]);
  });

  it("leaves periods that already have a sent, paid or voided invoice alone", () => {
    const p = plan([template({ autoIssue: true })], [inst("2026-09-15", "sent")]);
    expect(p.generate).toEqual([]);
    expect(p.issue).toEqual([]);
    for (const status of ["paid", "void"] as const) {
      const q = plan([template({ autoIssue: true })], [inst("2026-09-15", status)]);
      expect(q.generate).toEqual([]);
      expect(q.issue).toEqual([]);
    }
  });

  it("never brings back a period the owner skipped", () => {
    expect(plan([template({ skippedPeriods: ["2026-09-15"] })]).generate).toEqual([]);
    expect(
      plan([template({ autoIssue: true, skippedPeriods: ["2026-08-15"] })], [inst("2026-08-15", "draft")]).issue,
    ).toEqual([]);
  });

  it("stops at the template's end date and ignores inactive templates", () => {
    expect(plan([template({ endDate: "2026-08-31" })]).generate).toEqual([]);
    expect(plan([template({ endDate: "2026-09-15" })]).generate).toHaveLength(1);
    expect(plan([template({ isActive: false })]).generate).toEqual([]);
  });

  it("plans nothing for a period that has not come, and only what is due today", () => {
    expect(plan([template({ rule: rule({ startDate: "2026-10-01" }) })]).generate).toEqual([]);
    expect(plan([template({ rule: rule({ startDate: "2026-09-29" }) })]).generate.map((g) => g.period)).toEqual([
      "2026-09-29",
    ]);
  });

  it("plans month ends the way the schedule counts them", () => {
    const p = plan([template({ rule: rule({ startDate: "2026-01-31" }) })], [], "2026-09-30");
    expect(p.generate.map((g) => g.period)).toEqual(["2026-08-31", "2026-09-30"]);
    const feb = plan([template({ rule: rule({ startDate: "2026-01-31" }) })], [], "2026-03-01");
    expect(feb.generate.map((g) => g.period)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("is idempotent: applying a plan and planning again gives nothing", () => {
    const templates = [
      template({ autoIssue: true }),
      template({ id: "t2", rule: rule({ interval: 2, startDate: "2026-07-01" }) }),
    ];
    const first = plan(templates);
    const existing: ExistingInstance[] = first.generate.map((g) => ({
      templateId: g.templateId,
      period: g.period,
      status: g.issueAfter ? "sent" : "draft",
      invoiceId: `new-${g.templateId}-${g.period}`,
    }));
    const second: RecurringPlan = plan(templates, existing);
    expect(second.generate).toEqual([]);
    expect(second.issue).toEqual([]);
    expect(first.generate.length).toBeGreaterThan(0);
  });

  it("issues on the store's today, not on the period's day", () => {
    expect(plan([template()]).issueOn).toBe(TODAY);
  });

  it("keeps templates apart", () => {
    const p = plan(
      [template({ autoIssue: true }), template({ id: "t2", autoIssue: true })],
      [inst("2026-09-15", "sent", "t1")],
    );
    expect(p.generate).toEqual([{ templateId: "t2", period: "2026-09-15", issueAfter: true }]);
  });
});

describe("open periods, next occurrences and skips", () => {
  const t: RecurringTemplate = {
    id: "t1",
    isActive: true,
    autoIssue: false,
    rule: rule({ startDate: "2026-06-15" }),
    endDate: null,
    skippedPeriods: ["2026-07-15"],
  };

  it("lists due periods with no invoice or only a draft, oldest first, looking the whole window back", () => {
    const existing: ExistingInstance[] = [
      { templateId: "t1", period: "2026-06-15", status: "sent", invoiceId: "a" },
      { templateId: "t1", period: "2026-08-15", status: "draft", invoiceId: "b" },
      { templateId: "t2", period: "2026-09-15", status: "sent", invoiceId: "c" },
    ];
    expect(openPeriods(t, existing, "2026-09-29")).toEqual([
      { period: "2026-08-15", invoiceId: "b" },
      { period: "2026-09-15", invoiceId: null },
    ]);
  });

  it("finds the next occurrences after a day, up to the end date", () => {
    const r = rule({ startDate: "2026-01-31" });
    expect(nextOccurrences(r, "2026-09-29", 3)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
    expect(nextOccurrences(r, "2026-09-30", 3)).toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
    expect(nextOccurrences(r, "2026-09-29", 3, "2026-10-31")).toEqual(["2026-09-30", "2026-10-31"]);
    expect(nextOccurrences(r, "2026-10-31", 1)).toEqual(["2026-11-30"]);
    expect(nextOccurrences(rule({ period: "year", interval: 4, startDate: "2026-06-01" }), "2030-06-02", 1)).toEqual([
      "2034-06-01",
    ]);
  });

  it("adds a skipped period once, in order", () => {
    expect(withSkippedPeriod(["2026-09-15"], "2026-08-15")).toEqual(["2026-08-15", "2026-09-15"]);
    expect(withSkippedPeriod(["2026-09-15"], "2026-09-15")).toEqual(["2026-09-15"]);
  });
});
