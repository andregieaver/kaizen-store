import { describe, expect, it } from "vitest";

import { allowanceSeconds, cronHealth, jobsNeedingLook, type CronJobRow } from "./cron-health";

const now = new Date("2026-10-24T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
const row = (over: Partial<CronJobRow>): CronJobRow => ({
  job: "carts",
  everySeconds: 300,
  lastFinishedAt: ago(60),
  lastOkAt: ago(60),
  lastError: null,
  failures: 0,
  ...over,
});

describe("cron job health", () => {
  it("allows a job every minute eleven minutes, a five-minute job fifteen and a daily one thirty hours", () => {
    expect(allowanceSeconds(60)).toBe(660);
    expect(allowanceSeconds(300)).toBe(900);
    expect(allowanceSeconds(86_400)).toBe(86_400 + 21_600);
  });

  it("is late past its allowance, and fine within it", () => {
    expect(cronHealth(row({ lastFinishedAt: ago(899) }), now)).toBe("ok");
    expect(cronHealth(row({ lastFinishedAt: ago(901) }), now)).toBe("late");
    expect(cronHealth(row({ lastFinishedAt: null }), now)).toBe("late");
  });

  it("is failing after three failed runs in a row, however recent", () => {
    expect(cronHealth(row({ failures: 2, lastError: "boom" }), now)).toBe("ok");
    expect(cronHealth(row({ failures: 3, lastError: "boom" }), now)).toBe("failing");
  });

  it("lists failing jobs first, then the longest late, and leaves the fine ones out", () => {
    const list = jobsNeedingLook(
      [
        row({ job: "fine" }),
        row({ job: "late-a", lastFinishedAt: ago(1_000) }),
        row({ job: "late-b", lastFinishedAt: ago(5_000) }),
        row({ job: "broken", failures: 4 }),
      ],
      now,
    );
    expect(list.map((r) => [r.job, r.health])).toEqual([
      ["broken", "failing"],
      ["late-b", "late"],
      ["late-a", "late"],
    ]);
  });
});
