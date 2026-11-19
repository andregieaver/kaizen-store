import { describe, expect, it } from "vitest";

import { emailCounts, emailDays, emailsShown, emailWeek, isEmailShow } from "./email-log";

const row = (subject: string, status: string, createdAt: string, kind = "order.shipped") => ({ subject, status, createdAt, kind });
const rows = [
  row("[Test] Velkommen", "logged", "2026-11-16T21:20:00Z", "marketing.automation.test"),
  row("Bestilling på vei", "failed", "2026-11-16T08:00:00Z"),
  row("Data downloaded", "sent", "2026-11-15T20:10:00Z"),
  row("Old", "delivered", "2026-11-01T10:00:00Z"),
];
const now = new Date("2026-11-16T22:00:00Z").getTime();

describe("the platform's email list (round 16)", () => {
  it("counts and shows what each chip names", () => {
    expect(emailCounts(rows)).toEqual({ all: 4, unsent: 1, failed: 1, tests: 1 });
    expect(emailsShown(rows, "failed").map((r) => r.subject)).toEqual(["Bestilling på vei"]);
    expect(emailsShown(rows, "tests")).toHaveLength(1);
    expect(isEmailShow("tests")).toBe(true);
    expect(isEmailShow("spam")).toBe(false);
  });

  it("says what went in the last week", () => {
    expect(emailWeek(rows, now)).toEqual({ sent: 1, failed: 1 });
  });

  it("groups by the day in Norway: today, yesterday, then the date", () => {
    const days = emailDays(rows, now, { today: "Today", yesterday: "Yesterday" }, "Europe/Oslo");
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday", "1 November 2026"]);
    expect(days[0].rows).toHaveLength(2);
  });
});
