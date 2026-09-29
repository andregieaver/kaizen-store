import { describe, expect, it } from "vitest";

import {
  EMPTY_TIME_FILTERS,
  activeFilterCount,
  assignmentPayload,
  clientFigures,
  clientPayload,
  entryAccess,
  estimateField,
  moneyField,
  moveId,
  parseClientListParams,
  parseTimeFilters,
  progressView,
  readEntryDuration,
  readEstimate,
  readMoney,
  readWhole,
  remainingLabel,
  stageOf,
  taskPayload,
  timeFilterQuery,
  timePayload,
  type AssignmentFormValues,
  type ClientFormValues,
} from "./work-ui";

const ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const ID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("durations, estimates and amounts as typed", () => {
  it("reads logged time: a plain number is minutes, at most a day", () => {
    expect(readEntryDuration("1h30")).toEqual({ ok: true, minutes: 90 });
    expect(readEntryDuration("1:30")).toEqual({ ok: true, minutes: 90 });
    expect(readEntryDuration("90m")).toEqual({ ok: true, minutes: 90 });
    expect(readEntryDuration("45")).toEqual({ ok: true, minutes: 45 });
    expect(readEntryDuration("")).toMatchObject({ ok: false });
    expect(readEntryDuration("soon")).toMatchObject({ ok: false });
    expect(readEntryDuration("0")).toMatchObject({ ok: false, message: "Enter more than zero." });
    expect(readEntryDuration("25h")).toEqual({ ok: false, message: "One entry is at most 24 hours." });
  });

  it("reads an estimate: a plain number is hours, blank is none", () => {
    expect(readEstimate("")).toEqual({ ok: true, minutes: null });
    expect(readEstimate("  ")).toEqual({ ok: true, minutes: null });
    expect(readEstimate("2")).toEqual({ ok: true, minutes: 120 });
    expect(readEstimate("2,5")).toEqual({ ok: true, minutes: 150 });
    expect(readEstimate("1h30")).toEqual({ ok: true, minutes: 90 });
    expect(readEstimate("90m")).toEqual({ ok: true, minutes: 90 });
    // An estimate can be longer than a day.
    expect(readEstimate("40h")).toEqual({ ok: true, minutes: 2400 });
    expect(readEstimate("later")).toMatchObject({ ok: false, message: expect.stringContaining("not a time") });
  });

  it("puts an estimate back in its field so that it reads again", () => {
    for (const minutes of [1, 45, 60, 90, 150, 2400, 6_000_000]) {
      expect(readEstimate(estimateField(minutes))).toEqual({ ok: true, minutes });
    }
    expect(estimateField(null)).toBe("");
  });

  it("reads and writes amounts in the currency's own units", () => {
    expect(readMoney("", "NOK", "x")).toEqual({ ok: true, minor: null });
    expect(readMoney("950", "NOK", "x")).toEqual({ ok: true, minor: 95_000 });
    expect(readMoney("1 249,50", "NOK", "x")).toEqual({ ok: true, minor: 124_950 });
    expect(readMoney("abc", "NOK", "bad")).toEqual({ ok: false, message: "bad" });
    expect(moneyField(124_950, "NOK")).toBe("1249.50");
    expect(readMoney(moneyField(124_950, "NOK"), "NOK", "x")).toEqual({ ok: true, minor: 124_950 });
    expect(readMoney(moneyField(5000, "HUF"), "HUF", "x")).toEqual({ ok: true, minor: 5000 });
    expect(moneyField(null, "NOK")).toBe("");
  });

  it("reads whole numbers, and marks anything else so the schema's message answers", () => {
    expect(readWhole("")).toBeNull();
    expect(readWhole(" 14 ")).toBe(14);
    expect(readWhole("1.5")).toBeNaN();
    expect(readWhole("-3")).toBeNaN();
  });
});

const client = (over: Partial<ClientFormValues> = {}): ClientFormValues => ({
  name: "Acme AB",
  legalName: "",
  organisationNumber: "",
  vatNumber: "",
  country: "SE",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  billingEmail: "",
  contactName: "",
  phone: "",
  locale: "sv",
  currency: "SEK",
  hourlyRate: "",
  paymentDays: "",
  business: true,
  vatTreatment: "domestic",
  usePrepaid: true,
  notes: "",
  customerCompanyId: null,
  customerId: null,
  ...over,
});

describe("the client form", () => {
  it("makes the input the schema checks, with nothing typed left as none", () => {
    const result = clientPayload(client());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed).toMatchObject({
      name: "Acme AB",
      country: "SE",
      billingAddress: null,
      defaultHourlyRateMinor: null,
      paymentDays: null,
      legalName: null,
      vatTreatment: "domestic",
    });
  });

  it("reads the rate and days, and gathers the address", () => {
    const result = clientPayload(
      client({
        hourlyRate: "950,50",
        paymentDays: "30",
        line1: "Storgatan 1",
        postalCode: "111 22",
        city: "Stockholm",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.defaultHourlyRateMinor).toBe(95_050);
    expect(result.parsed.paymentDays).toBe(30);
    expect(result.parsed.billingAddress).toEqual({
      line1: "Storgatan 1",
      line2: "",
      postalCode: "111 22",
      city: "Stockholm",
    });
  });

  it("says what is wrong, field by field", () => {
    const result = clientPayload(
      client({ name: " ", hourlyRate: "lots", paymentDays: "3.5", billingEmail: "nope", currency: "XXX" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.fields.name).toBe("Give the client a name.");
    expect(result.problems.fields.hourlyRate).toContain("hourly rate");
    expect(result.problems.fields.paymentDays).toContain("whole number");
    expect(result.problems.fields.billingEmail).toBe("That email address is not right.");
    expect(result.problems.fields.currency).toBe("Choose a currency.");
  });

  it("keeps a private customer at domestic VAT whatever the treatment says", () => {
    const result = clientPayload(client({ business: false, vatTreatment: "reverse_charge" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.vatTreatment).toBe("domestic");
  });

  it("carries the links to a customer, so saving does not undo them", () => {
    const result = clientPayload(client({ customerCompanyId: ID, customerId: ID2 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed).toMatchObject({ customerCompanyId: ID, customerId: ID2 });
  });
});

const assignment = (over: Partial<AssignmentFormValues> = {}): AssignmentFormValues => ({
  clientId: ID,
  name: "Website",
  status: "active",
  billingType: "hourly",
  hourlyRate: "",
  fixedAmount: "",
  estimate: "",
  startDate: "",
  endDate: "",
  alertMinutes: "10",
  alertPopup: true,
  alertSound: false,
  ...over,
});

describe("the assignment form", () => {
  it("makes the input, reading the estimate as hours and the rate in the client's currency", () => {
    const result = assignmentPayload(assignment({ hourlyRate: "1 100", estimate: "20", alertMinutes: "15" }), "SEK");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed).toMatchObject({
      hourlyRateMinor: 110_000,
      estimatedMinutes: 1200,
      estimateAlertMinutes: 15,
      fixedAmountMinor: null,
      startDate: null,
    });
  });

  it("switches warnings off with an empty field", () => {
    const result = assignmentPayload(assignment({ alertMinutes: "" }), "SEK");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.estimateAlertMinutes).toBeNull();
  });

  it("drops the hourly rate of a fixed fee and the fee of an hourly assignment", () => {
    const fixed = assignmentPayload(
      assignment({ billingType: "fixed_fee", hourlyRate: "900", fixedAmount: "12000" }),
      "SEK",
    );
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(fixed.parsed).toMatchObject({ hourlyRateMinor: null, fixedAmountMinor: 1_200_000 });
    const hourly = assignmentPayload(assignment({ hourlyRate: "900", fixedAmount: "12000" }), "SEK");
    expect(hourly.ok).toBe(true);
    if (hourly.ok) expect(hourly.parsed).toMatchObject({ hourlyRateMinor: 90_000, fixedAmountMinor: null });
  });

  it("says what is wrong, field by field", () => {
    const noFee = assignmentPayload(assignment({ billingType: "fixed_fee" }), "SEK");
    expect(noFee.ok).toBe(false);
    if (!noFee.ok) expect(noFee.problems.fields.fixedAmount).toBe("A fixed fee needs an amount.");

    const bad = assignmentPayload(
      assignment({ name: "", estimate: "soon", alertMinutes: "999", startDate: "2026-10-02", endDate: "2026-10-01" }),
      "SEK",
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems.fields.name).toBe("Give the assignment a name.");
    expect(bad.problems.fields.estimate).toContain("not a time");
    expect(bad.problems.fields.alertMinutes).toContain("480");
    expect(bad.problems.fields.endDate).toBe("The end comes before the start.");
  });
});

describe("tasks and time entries", () => {
  it("makes a task with an estimate in minutes", () => {
    expect(taskPayload(ID, "Design", "1h30")).toEqual({
      ok: true,
      input: { assignmentId: ID, title: "Design", status: "open", estimatedMinutes: 90 },
    });
    expect(taskPayload(ID, "Design", "")).toMatchObject({ ok: true, input: { estimatedMinutes: null } });
  });

  it("refuses an empty name and an unreadable estimate", () => {
    const empty = taskPayload(ID, "  ", "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.problems.fields.title).toBe("Give the task a name.");
    const bad = taskPayload(ID, "Design", "eh");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.fields.estimate).toContain("not a time");
  });

  it("makes a time entry from what was typed", () => {
    const result = timePayload({
      assignmentId: ID,
      taskId: "",
      workDate: "2026-09-29",
      duration: "1h30",
      note: " call ",
      billable: false,
    });
    expect(result).toEqual({
      ok: true,
      input: { assignmentId: ID, taskId: null, workDate: "2026-09-29", minutes: 90, billable: false, note: " call " },
    });
  });

  it("says what is wrong with a time entry", () => {
    const result = timePayload({ assignmentId: "", taskId: "", workDate: "", duration: "", note: "", billable: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.fields.assignmentId).toContain("assignment");
    expect(result.problems.fields.duration).toContain("time");
    const day = timePayload({
      assignmentId: ID,
      taskId: "",
      workDate: "yesterday",
      duration: "1h",
      note: "",
      billable: true,
    });
    expect(day.ok).toBe(false);
    if (!day.ok) expect(day.problems.fields.workDate).toBe("Give the date the work was done.");
  });
});

describe("moving a task with the keyboard", () => {
  const list = ["a", "b", "c", "d"];
  it("moves one place up or down", () => {
    expect(moveId(list, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveId(list, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveId(list, "a", 3)).toEqual(["b", "c", "d", "a"]);
  });
  it("stops at the ends and changes nothing for an unknown id", () => {
    expect(moveId(list, "a", -1)).toEqual(list);
    expect(moveId(list, "d", 1)).toEqual(list);
    expect(moveId(list, "x", 1)).toEqual(list);
    expect(moveId(list, "c", 10)).toEqual(["a", "b", "d", "c"]);
  });
  it("does not change the list it was given", () => {
    const before = [...list];
    moveId(list, "b", 1);
    expect(list).toEqual(before);
  });
});

describe("the estimate bar", () => {
  it("has nothing to say without an estimate", () => {
    expect(progressView(300, null, 10)).toEqual({ stage: "ok", fill: 0, percent: null, remaining: null, label: "" });
    expect(progressView(300, 0, 10).percent).toBeNull();
  });

  it("is on track, nearly used up, and over, by the warning threshold", () => {
    expect(progressView(60, 120, 10)).toMatchObject({ stage: "ok", percent: 50, fill: 50, label: "1h left" });
    // Exactly the threshold left has not fired: strictly less does.
    expect(progressView(110, 120, 10).stage).toBe("ok");
    expect(progressView(111, 120, 10)).toMatchObject({ stage: "near", label: "9m left" });
    expect(progressView(120, 120, 10)).toMatchObject({ stage: "over", percent: 100, label: "Used up" });
    expect(progressView(150, 120, 10)).toMatchObject({ stage: "over", percent: 125, fill: 100, label: "30m over" });
  });

  it("does not call it nearly used up when warnings are off, but an estimate used up is still over", () => {
    expect(progressView(119, 120, null).stage).toBe("ok");
    expect(progressView(130, 120, null).stage).toBe("over");
    expect(stageOf(null, 10)).toBe("ok");
  });

  it("words what is left", () => {
    expect(remainingLabel(null)).toBe("");
    expect(remainingLabel(90)).toBe("1h 30m left");
    expect(remainingLabel(-15)).toBe("15m over");
    expect(remainingLabel(0)).toBe("Used up");
  });
});

describe("who may change an entry", () => {
  const entry = { accountId: "me", invoiceStatus: null, locked: false } as const;
  it("lets people change their own, and owners anyone's", () => {
    expect(entryAccess(entry, { accountId: "me", owner: false })).toEqual({ note: true, delete: true, why: null });
    expect(entryAccess(entry, { accountId: "you", owner: false })).toMatchObject({ note: false, delete: false });
    expect(entryAccess(entry, { accountId: "you", owner: true })).toMatchObject({ note: true, delete: true });
  });
  it("keeps time on a draft to its note, and time on an issued invoice fixed", () => {
    expect(entryAccess({ ...entry, invoiceStatus: "draft" }, { accountId: "me", owner: false })).toEqual({
      note: true,
      delete: false,
      why: "On a draft invoice",
    });
    expect(entryAccess({ ...entry, invoiceStatus: "paid", locked: true }, { accountId: "me", owner: true })).toEqual({
      note: false,
      delete: false,
      why: "On an issued invoice",
    });
  });
});

describe("the Time page's filters", () => {
  it("reads what an address asks for", () => {
    const filters = parseTimeFilters({
      client: ID,
      assignment: ID2,
      person: ID,
      from: "2026-09-01",
      to: "2026-09-30",
      billable: "yes",
      billing: "unbilled",
      q: " call ",
    });
    expect(filters).toEqual({
      clientId: ID,
      assignmentId: ID2,
      accountId: ID,
      from: "2026-09-01",
      to: "2026-09-30",
      billable: "yes",
      billing: "unbilled",
      query: "call",
    });
    expect(activeFilterCount(filters)).toBe(8);
  });

  it("drops what is not what a field takes, and never throws on a hand-edited address", () => {
    expect(
      parseTimeFilters({
        client: "'; drop table",
        from: "2026-13-40",
        billable: "maybe",
        billing: ["x"],
        q: ["a", "b"],
      }),
    ).toEqual({ ...EMPTY_TIME_FILTERS, query: "a" });
    expect(parseTimeFilters({})).toEqual(EMPTY_TIME_FILTERS);
    expect(activeFilterCount(EMPTY_TIME_FILTERS)).toBe(0);
  });

  it("puts the days the right way round", () => {
    expect(parseTimeFilters({ from: "2026-09-30", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("makes the address back, leaving out what is not set", () => {
    expect(timeFilterQuery(EMPTY_TIME_FILTERS)).toBe("");
    expect(timeFilterQuery({ ...EMPTY_TIME_FILTERS, clientId: ID, billing: "invoiced" }, { page: "2" })).toBe(
      `?client=${ID}&billing=invoiced&page=2`,
    );
    const filters = parseTimeFilters({ client: ID, from: "2026-09-01", billable: "no", q: "a b" });
    expect(parseTimeFilters(Object.fromEntries(new URLSearchParams(timeFilterQuery(filters))))).toEqual(filters);
  });
});

describe("the client list", () => {
  it("reads its filter from the address", () => {
    expect(parseClientListParams({})).toEqual({ show: "active", query: "" });
    expect(parseClientListParams({ show: "archived", q: " acme " })).toEqual({ show: "archived", query: "acme" });
    expect(parseClientListParams({ show: "everything" })).toEqual({ show: "active", query: "" });
  });

  it("says what is going on for a client in a line", () => {
    expect(clientFigures({ activeAssignments: 0, unbilledMinutes: 0 })).toBe(
      "No active assignments · nothing unbilled",
    );
    expect(clientFigures({ activeAssignments: 1, unbilledMinutes: 90 })).toBe("1 active assignment · 1h 30m unbilled");
    expect(clientFigures({ activeAssignments: 3, unbilledMinutes: 45 })).toBe("3 active assignments · 45m unbilled");
  });
});
