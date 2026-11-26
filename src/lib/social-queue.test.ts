import { describe, expect, it } from "vitest";

import { nextTry, QUEUE_TRIES_MAX, scheduleFor } from "./social-queue";

describe("the posting queue (D870 S3.2)", () => {
  // Wednesday 26 November 2026, 08:00 UTC: 09:00 in Oslo.
  const now = new Date("2026-11-26T08:00:00Z");

  it("puts an approved post out at 10:00 in the store's time on its planned day", () => {
    expect(scheduleFor("2026-11-28", "Europe/Oslo", now)?.toISOString()).toBe("2026-11-28T09:00:00.000Z");
    expect(scheduleFor("2026-11-26", "Europe/Oslo", now)?.toISOString()).toBe("2026-11-26T09:00:00.000Z");
    expect(scheduleFor("2026-11-28", "America/New_York", now)?.toISOString()).toBe("2026-11-28T15:00:00.000Z");
  });

  it("puts one planned for today out now once its hour has passed, and never queues a day gone by or no day", () => {
    const later = new Date("2026-11-26T13:00:00Z");
    expect(scheduleFor("2026-11-26", "Europe/Oslo", later)).toEqual(later);
    expect(scheduleFor("2026-11-25", "Europe/Oslo", later)).toBeNull();
    expect(scheduleFor(null, "Europe/Oslo", later)).toBeNull();
  });

  it("waits 15 minutes after the first refusal, an hour after the second, then gives up for a person", () => {
    expect(nextTry(1, now)?.toISOString()).toBe("2026-11-26T08:15:00.000Z");
    expect(nextTry(2, now)?.toISOString()).toBe("2026-11-26T09:00:00.000Z");
    expect(nextTry(QUEUE_TRIES_MAX, now)).toBeNull();
  });
});
