import { describe, expect, it } from "vitest";

import {
  DUE_SOON_DAYS,
  FRESH_SIGN_IN_MINUTES,
  addUtcMonths,
  daysLeft,
  effectiveDue,
  erasedEmailKey,
  erasureConfirmed,
  extendInput,
  extensionLimit,
  extensionProblem,
  isFresh,
  isOverdue,
  logRequestInput,
  privacyDeadline,
  receivedInstant,
  receivedProblem,
  refuseInput,
  reminderDue,
  reminderKey,
  type RequestClock,
} from "./privacy-request";

const at = (iso: string) => new Date(iso);

const clock = (received: string, over: Partial<RequestClock> = {}): RequestClock => ({
  status: "open",
  receivedAt: at(received),
  dueAt: privacyDeadline(at(received)),
  extendedUntil: null,
  ...over,
});

describe("the one-month clock (GDPR Art. 12(3))", () => {
  it("is the same day of the next month, clamped to the last day of a shorter month, in UTC", () => {
    expect(privacyDeadline(at("2026-10-04T09:30:00.000Z")).toISOString()).toBe("2026-11-04T09:30:00.000Z");
    expect(privacyDeadline(at("2026-01-31T00:00:00.000Z")).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(privacyDeadline(at("2028-01-31T00:00:00.000Z")).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(privacyDeadline(at("2026-12-31T23:59:59.000Z")).toISOString()).toBe("2027-01-31T23:59:59.000Z");
    expect(privacyDeadline(at("2026-03-31T00:00:00.000Z")).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("never lets a weekend or holiday extend the month (the safe side of an unread rule)", () => {
    // 2026-11-01 is a Sunday: a request received on 2026-10-01 is still due 1 November.
    expect(new Date("2026-11-01T00:00:00.000Z").getUTCDay()).toBe(0);
    expect(privacyDeadline(at("2026-10-01T00:00:00.000Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("allows an extension to at most three months from receipt, clamped the same way", () => {
    expect(extensionLimit(at("2026-10-04T00:00:00.000Z")).toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(extensionLimit(at("2026-11-30T00:00:00.000Z")).toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(addUtcMonths(at("2026-08-31T00:00:00.000Z"), 3).toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(addUtcMonths(at("2026-02-15T00:00:00.000Z"), -2).toISOString()).toBe("2025-12-15T00:00:00.000Z");
  });

  it("is overdue only while open and after the due moment (the extended one once there is one)", () => {
    const r = clock("2026-10-04T00:00:00.000Z");
    expect(isOverdue(r, at("2026-11-04T00:00:00.000Z"))).toBe(false);
    expect(isOverdue(r, at("2026-11-04T00:00:00.001Z"))).toBe(true);
    const extended = { ...r, extendedUntil: at("2027-01-04T00:00:00.000Z") };
    expect(effectiveDue(extended).toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(isOverdue(extended, at("2026-12-01T00:00:00.000Z"))).toBe(false);
    expect(isOverdue({ ...r, status: "done" }, at("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(isOverdue({ ...r, status: "refused" }, at("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("counts the days left, rounded up, negative once overdue", () => {
    const r = clock("2026-10-04T00:00:00.000Z");
    expect(daysLeft(r, at("2026-10-04T00:00:00.000Z"))).toBe(31);
    expect(daysLeft(r, at("2026-11-03T12:00:00.000Z"))).toBe(1);
    expect(daysLeft(r, at("2026-11-04T00:00:00.000Z"))).toBe(0);
    expect(daysLeft(r, at("2026-11-06T00:00:00.000Z"))).toBe(-2);
  });
});

describe("extending a request", () => {
  const r = clock("2026-10-04T00:00:00.000Z");
  it("is allowed once, before the due date, with a reason", () => {
    expect(extensionProblem(r, at("2026-10-20T00:00:00.000Z"), "A large account")).toBeNull();
    expect(extensionProblem(r, at("2026-11-04T00:00:00.000Z"), "A large account")).toBeNull();
    expect(extensionProblem(r, at("2026-11-04T00:00:00.001Z"), "A large account")).toBe("too_late");
    expect(extensionProblem(r, at("2026-10-20T00:00:00.000Z"), "   ")).toBe("no_reason");
    expect(extensionProblem({ ...r, extendedUntil: at("2027-01-04T00:00:00.000Z") }, at("2026-10-20T00:00:00.000Z"), "again")).toBe("already_extended");
    expect(extensionProblem({ ...r, status: "done" }, at("2026-10-20T00:00:00.000Z"), "x")).toBe("not_open");
  });
});

describe("reminders", () => {
  const r = clock("2026-10-04T00:00:00.000Z");
  it("asks the owners seven days before the due date, and once when overdue, and never for an answered request", () => {
    expect(DUE_SOON_DAYS).toBe(7);
    expect(reminderDue(r, at("2026-10-27T00:00:00.000Z"))).toBeNull(); // 8 days left
    expect(reminderDue(r, at("2026-10-28T00:00:00.000Z"))).toBe("due_soon"); // 7 days left
    expect(reminderDue(r, at("2026-11-04T00:00:00.000Z"))).toBe("due_soon");
    expect(reminderDue(r, at("2026-11-05T00:00:00.000Z"))).toBe("overdue");
    expect(reminderDue({ ...r, status: "cancelled" }, at("2026-11-05T00:00:00.000Z"))).toBeNull();
    expect(reminderKey("due_soon", "abc")).toBe("privacy.due:abc");
    expect(reminderKey("overdue", "abc")).toBe("privacy.overdue:abc");
    expect(erasedEmailKey("abc")).toBe("privacy.erased:abc");
  });
});

describe("a fresh sign-in", () => {
  it("lasts ten minutes from the last proof of identity, and a missing or future time is never fresh", () => {
    expect(FRESH_SIGN_IN_MINUTES).toBe(10);
    const now = at("2026-10-04T12:00:00.000Z");
    expect(isFresh(at("2026-10-04T11:50:00.000Z"), now)).toBe(true);
    expect(isFresh(at("2026-10-04T11:49:59.999Z"), now)).toBe(false);
    expect(isFresh(at("2026-10-04T12:00:00.000Z"), now)).toBe(true);
    expect(isFresh(at("2026-10-04T12:00:01.000Z"), now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
  });
});

describe("what staff send", () => {
  it("logs a request with a lower-cased email, the day it was received and a note", () => {
    const ok = logRequestInput.parse({ kind: "erasure", email: "  Ola@Example.COM ", receivedOn: "2026-10-01", note: " by email " });
    expect(ok).toEqual({ kind: "erasure", email: "ola@example.com", receivedOn: "2026-10-01", note: "by email" });
    expect(logRequestInput.safeParse({ kind: "delete", email: "a@b.no", receivedOn: "2026-10-01" }).success).toBe(false);
    expect(logRequestInput.safeParse({ kind: "export", email: "not-an-email", receivedOn: "2026-10-01" }).success).toBe(false);
    expect(logRequestInput.safeParse({ kind: "export", email: "a@b.no", receivedOn: "yesterday" }).success).toBe(false);
  });

  it("needs a reason to extend and a reason from the closed list to refuse", () => {
    expect(extendInput.safeParse({ reason: "   " }).success).toBe(false);
    expect(extendInput.parse({ reason: " Many orders " })).toEqual({ reason: "Many orders" });
    expect(refuseInput.safeParse({ reason: "because" }).success).toBe(false);
    expect(refuseInput.parse({ reason: "excessive" })).toEqual({ reason: "excessive", note: "" });
  });

  it("starts the clock at the start of the day the request was received, and refuses a future day", () => {
    const now = at("2026-10-04T10:00:00.000Z");
    expect(receivedInstant("2026-10-01").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(receivedProblem("2026-10-04", now)).toBeNull();
    expect(receivedProblem("2026-10-05", now)).toBe("future");
    expect(receivedProblem("2025-09-01", now)).toBe("too_old");
    expect(receivedProblem("2026-02-30", now)).not.toBeNull();
  });

  it("asks for the subject's own email, or the word ERASE for a subject with none, before an erasure", () => {
    expect(erasureConfirmed(" OLA@example.com ", "ola@example.com")).toBe(true);
    expect(erasureConfirmed("kari@example.com", "ola@example.com")).toBe(false);
    expect(erasureConfirmed("", "ola@example.com")).toBe(false);
    expect(erasureConfirmed("ERASE", null)).toBe(true);
    expect(erasureConfirmed("erase", null)).toBe(false);
    expect(erasureConfirmed("ERASE", "ola@example.com")).toBe(false);
  });
});
