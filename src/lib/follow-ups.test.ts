import { describe, expect, it } from "vitest";

import { followUpEmail } from "./follow-up-email";
import { dueFrom, dueWords, followUpMessage, localInstant, localTimeOf, nextDue } from "./follow-ups";
import { staffEmailsNb } from "./admin-messages/staff-emails.nb";

const OSLO = "Europe/Oslo";
const now = new Date("2026-10-20T10:00:00Z");

describe("when a follow-up is due", () => {
  it("reads a wall-clock time in the time zone, or hours from now", () => {
    const at = dueFrom({ at: "2026-10-23 09:00" }, OSLO, now);
    expect(at).toEqual({ ok: true, due: new Date("2026-10-23T07:00:00Z") });
    expect(dueFrom({ at: "2026-10-23T09:00" }, OSLO, now)).toEqual(at);
    expect(dueFrom({ inHours: 2 }, OSLO, now)).toEqual({ ok: true, due: new Date("2026-10-20T12:00:00Z") });
  });

  it("refuses what is not a time, too soon or too far ahead", () => {
    expect(dueFrom({ at: "tomorrow" }, OSLO, now).ok).toBe(false);
    expect(dueFrom({ at: "2026-02-30 09:00" }, OSLO, now).ok).toBe(false);
    expect(dueFrom({ at: "2026-10-23 25:00" }, OSLO, now).ok).toBe(false);
    expect(dueFrom({}, OSLO, now).ok).toBe(false);
    expect(dueFrom({ inHours: 0.05 }, OSLO, now).ok).toBe(false);
    expect(dueFrom({ at: "2026-10-19 09:00" }, OSLO, now).ok).toBe(false);
    expect(dueFrom({ at: "2027-12-01 09:00" }, OSLO, now).ok).toBe(false);
    expect(localInstant("2026-02-29 10:00", OSLO)).toBeNull();
  });
});

describe("a repeating follow-up", () => {
  it("keeps its time of day across a change of clocks", () => {
    // Oslo leaves summer time on 25 October 2026: 09:00 is 07:00 UTC before and 08:00 UTC after.
    const due = new Date("2026-10-23T07:00:00Z");
    const next = nextDue(due, "weekly", OSLO, new Date("2026-10-23T07:01:00Z"))!;
    expect(next.toISOString()).toBe("2026-10-30T08:00:00.000Z");
    expect(localTimeOf(next, OSLO)).toBe("09:00");
  });

  it("skips the times a late run missed, and a one-off has no next time", () => {
    const due = new Date("2026-10-20T07:00:00Z");
    expect(nextDue(due, "daily", OSLO, new Date("2026-10-23T12:00:00Z"))?.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(nextDue(due, "none", OSLO, now)).toBeNull();
  });

  it("says when in words, and the message carries the task and that nobody is there", () => {
    // The comma after the weekday depends on the runtime's locale data.
    expect(dueWords(new Date("2026-10-23T07:00:00Z"), "weekly", OSLO)).toMatch(/^Friday,? 23 October 2026 at 09:00, then every week$/);
    const message = followUpMessage("Check whether order 1042 was sent", now, "none", OSLO);
    expect(message).toContain("[Follow-up, asked for on 20 October 2026] Check whether order 1042 was sent");
    expect(message).toContain("They are not here");
  });
});

describe("the follow-up email", () => {
  const facts = { task: "Check whether order 1042 was sent", store: "Demo", url: "https://kaizenaflow.com/admin/demo/assistant?c=x", waiting: true, next: null };

  it("names the task and where to read the answer, never the answer", () => {
    const email = followUpEmail({ ...facts, outcome: "done" });
    expect(email.subject).toBe('The AI manager followed up: "Check whether order 1042 was sent"');
    const text = JSON.stringify(email.blocks);
    expect(text).toContain("in Demo");
    expect(text).toContain("A change is waiting for your yes there.");
    expect(email.blocks.at(-1)).toEqual({ type: "button", text: "Read the answer", url: facts.url });
  });

  it("says when it could not be done, in the person's language", () => {
    const email = followUpEmail({ ...facts, store: null, outcome: "failed" }, staffEmailsNb, "nb");
    expect(email.subject).toContain("KI-assistenten kunne ikke følge opp");
    expect(email.lang).toBe("nb");
    expect(JSON.stringify(email.blocks)).not.toContain(" i Demo");
  });

  it("shortens a long task in the subject", () => {
    const email = followUpEmail({ ...facts, task: "x".repeat(200), outcome: "done" });
    expect(email.subject.length).toBeLessThan(100);
  });
});
