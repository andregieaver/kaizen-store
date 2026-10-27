import { describe, expect, it } from "vitest";

import { REVERT_GAP_MINUTES, SCHEDULE_LATEST_DAYS, isScheduledType, revertInstant, scheduleChip, type ScheduleChipWords } from "./page-schedules";

/**
 * Changes by the clock (wave 7 unit F, D340): the way back's time is the store's own clock, at least a little after the change goes live
 * and within a year of it; headers and footers are scheduled as pages are; and a list's chip says what happens next, else what did not.
 */

const words: ScheduleChipWords = { publishes: "Publishes {when}", goesBack: "Goes back {when}", didNotPublish: "Did not publish ({when})", didNotGoBack: "Did not go back ({when})" };
const when = (iso: string) => iso.slice(0, 16);

describe("the way back's time", () => {
  const live = new Date("2026-11-02T08:00:00Z");

  it("is a day and time on the store's clock after the change goes live", () => {
    // 10:00 in Oslo in November is 09:00 UTC.
    expect(revertInstant("2026-11-02", "10:00", "Europe/Oslo", live)).toEqual({ ok: true, at: new Date("2026-11-02T09:00:00Z") });
  });

  it(`is at least ${REVERT_GAP_MINUTES} minutes after it, and within a year`, () => {
    expect(revertInstant("2026-11-02", "09:05", "Europe/Oslo", live)).toEqual({ ok: false, problem: "revert_too_soon" });
    expect(revertInstant("2026-11-02", "08:00", "Europe/Oslo", live)).toEqual({ ok: false, problem: "revert_too_soon" });
    const late = new Date(live.getTime() + (SCHEDULE_LATEST_DAYS + 2) * 86_400_000).toISOString().slice(0, 10);
    expect(revertInstant(late, "09:00", "Europe/Oslo", live)).toEqual({ ok: false, problem: "revert_too_late" });
    expect(revertInstant("soon", "", "Europe/Oslo", live)).toEqual({ ok: false, problem: "revert_not_a_time" });
  });
});

describe("what is scheduled", () => {
  it("covers pages, articles, headers and footers, and nothing else", () => {
    for (const type of ["page", "article", "header", "footer"]) expect(isScheduledType(type)).toBe(true);
    for (const type of ["product_layout", "variant", "entry_layout", "theme", null]) expect(isScheduledType(type)).toBe(false);
  });
});

describe("a list's chip", () => {
  it("names the next thing to happen, with the way back beside a publish", () => {
    expect(scheduleChip({ publishAt: "2026-11-02T09:00:00Z", revertAt: "2026-11-09T09:00:00Z", failure: null }, words, when)).toEqual({
      signal: "neutral",
      text: "Publishes 2026-11-02T09:00",
      detail: "Goes back 2026-11-09T09:00",
    });
    expect(scheduleChip({ publishAt: null, revertAt: "2026-11-09T09:00:00Z", failure: null }, words, when)).toEqual({ signal: "neutral", text: "Goes back 2026-11-09T09:00", detail: null });
  });

  it("says what did not happen, and why, as a warning", () => {
    expect(scheduleChip({ publishAt: null, revertAt: null, failure: { leg: "revert", at: "2026-11-09T09:01:00Z", problem: "The page was changed." } }, words, when)).toEqual({
      signal: "warning",
      text: "Did not go back (2026-11-09T09:01)",
      detail: "The page was changed.",
    });
    expect(scheduleChip({ publishAt: null, revertAt: null, failure: { leg: "publish", at: "2026-11-02T09:01:00Z", problem: "" } }, words, when)?.text).toBe("Did not publish (2026-11-02T09:01)");
  });

  it("is nothing when nothing waits or failed", () => {
    expect(scheduleChip({ publishAt: null, revertAt: null, failure: null }, words, when)).toBeNull();
  });
});
