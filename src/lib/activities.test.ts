import { describe, expect, it } from "vitest";

import { activityWhen, cleanActivityInput, dueFields, nextActivity, todayList, todayWindow } from "./activities";

const OSLO = "Europe/Oslo";
const DEAL = "00000000-0000-4000-8000-0000000000d1";
const PERSON = "00000000-0000-4000-8000-0000000000c1";

describe("an activity as a person types it", () => {
  it("is due at the time typed in the store's time zone, or at the start of the day when none is", () => {
    expect(cleanActivityInput({ kind: "call", title: "  Call  about the  quote ", dueOn: "2026-11-09", dueTime: "10:30", dealId: DEAL }, OSLO)).toEqual({
      ok: true,
      activity: { kind: "call", title: "Call about the quote", note: null, dueAt: "2026-11-09T09:30:00.000Z", timed: true, durationMinutes: null, assigneeId: null, customerId: null, companyId: null, dealId: DEAL },
    });
    // Summer time: 10:30 in Oslo is 08:30 UTC.
    expect(cleanActivityInput({ kind: "task", title: "Send samples", dueOn: "2026-06-12", customerId: PERSON }, OSLO)).toMatchObject({
      ok: true,
      activity: { dueAt: "2026-06-11T22:00:00.000Z", timed: false },
    });
  });

  it("keeps a length only for a meeting, and the note as written", () => {
    expect(cleanActivityInput({ kind: "meeting", title: "Fair stand", dueOn: "2026-11-10", dueTime: "13:00", duration: "45", note: " Bring the catalogue.\nAnd tea. ", customerId: PERSON }, OSLO)).toMatchObject({
      ok: true,
      activity: { durationMinutes: 45, note: "Bring the catalogue.\nAnd tea." },
    });
    expect(cleanActivityInput({ kind: "call", title: "Call", dueOn: "2026-11-10", duration: "45", customerId: PERSON }, OSLO)).toMatchObject({ ok: true, activity: { durationMinutes: null } });
  });

  it("says what is missing or wrong, all at once", () => {
    expect(cleanActivityInput({ kind: "lunch", title: " ", dueOn: "2026-13-40", dueTime: "25:00", duration: "-5", assigneeId: "nobody" }, OSLO)).toEqual({
      ok: false,
      problems: ["kind", "title", "due", "duration", "assignee", "who"],
    });
    expect(cleanActivityInput({ kind: "task", title: "x", dueOn: "2026-11-10", note: "n".repeat(2001), dealId: DEAL }, OSLO)).toEqual({ ok: false, problems: ["note"] });
  });

  it("gives its form back the day and time it was typed with", () => {
    expect(dueFields("2026-11-09T09:30:00.000Z", true, OSLO)).toEqual({ dueOn: "2026-11-09", dueTime: "10:30" });
    expect(dueFields("2026-06-11T22:00:00.000Z", false, OSLO)).toEqual({ dueOn: "2026-06-12", dueTime: "" });
  });
});

describe("the Today list", () => {
  const now = new Date("2026-11-09T12:00:00Z"); // 13:00 in Oslo
  const a = (id: string, dueAt: string, timed: boolean, doneAt: string | null = null) => ({ id, dueAt, timed, doneAt });

  it("is what is late, then today's with a time in order, then today's for the day, then what was done today", () => {
    const list = todayList(
      [
        a("later", "2026-11-10T08:00:00Z", true),
        a("day", "2026-11-08T23:00:00Z", false),
        a("afternoon", "2026-11-09T14:00:00Z", true),
        a("lateCall", "2026-11-09T09:00:00Z", true),
        a("yesterday", "2026-11-08T09:00:00Z", true),
        a("doneToday", "2026-11-09T08:00:00Z", true, "2026-11-09T08:30:00Z"),
        a("doneBefore", "2026-11-05T08:00:00Z", true, "2026-11-05T08:30:00Z"),
      ],
      now,
      OSLO,
    );
    expect(list.late.map((x) => x.id)).toEqual(["yesterday", "lateCall"]);
    expect(list.today.map((x) => x.id)).toEqual(["afternoon", "day"]);
    expect(list.done.map((x) => x.id)).toEqual(["doneToday"]);
  });

  it("counts a call within the hour of its time as today's, not late", () => {
    expect(activityWhen(a("x", "2026-11-09T11:30:00Z", true), now, OSLO)).toBe("today");
    expect(activityWhen(a("x", "2026-11-09T10:30:00Z", true), now, OSLO)).toBe("late");
  });

  it("reads the store's day, and a deal's next step is its earliest open activity", () => {
    expect(todayWindow(now, OSLO)).toEqual({ startOfToday: "2026-11-08T23:00:00.000Z", endOfToday: "2026-11-09T23:00:00.000Z" });
    expect(nextActivity([a("done", "2026-11-01T08:00:00Z", true, "2026-11-01T09:00:00Z"), a("b", "2026-11-12T08:00:00Z", true), a("a", "2026-11-11T08:00:00Z", false)])?.id).toBe("a");
    expect(nextActivity([a("done", "2026-11-01T08:00:00Z", true, "2026-11-01T09:00:00Z")])).toBeNull();
  });
});
