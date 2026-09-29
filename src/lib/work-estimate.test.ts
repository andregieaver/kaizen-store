import { describe, expect, it } from "vitest";

import {
  ALERT_CHIME_NOTES,
  DEFAULT_ESTIMATE_ALERTS,
  DEFAULT_ESTIMATE_ALERT_MINUTES,
  alertToRaise,
  elapsedWholeMinutes,
  estimateStage,
  parseEstimateAlertMinutes,
  remainingMinutes,
  timerAlertStorageKey,
  utilisationPercent,
  type EstimateStage,
} from "./work-estimate";

describe("estimates against time spent (Life's smoke cases)", () => {
  it("counts the minutes left", () => {
    expect(remainingMinutes(150, 90)).toBe(60); // 2.5 h less 90 min
    expect(remainingMinutes(60, 75)).toBe(-15); // over-spend is negative
    expect(remainingMinutes(null, 30)).toBeNull(); // no estimate, nothing to be left of
    expect(remainingMinutes(undefined, 30)).toBeNull();
    expect(remainingMinutes(Number.NaN, 30)).toBeNull();
  });

  it("knows the stage: strictly less than the threshold is near", () => {
    expect(estimateStage(60, 10)).toBe("ok");
    expect(estimateStage(10, 10)).toBe("ok"); // exactly the threshold has not fired
    expect(estimateStage(9, 10)).toBe("near");
    expect(estimateStage(1, 10)).toBe("near");
    expect(estimateStage(0, 10)).toBe("over");
    expect(estimateStage(-30, 10)).toBe("over");
    expect(estimateStage(null, 10)).toBe("ok"); // a task without an estimate never warns
    expect(estimateStage(5, null)).toBe("ok"); // warnings off
    expect(estimateStage(0, null)).toBe("ok");
  });

  it("keeps Life's defaults", () => {
    expect(DEFAULT_ESTIMATE_ALERT_MINUTES).toBe(10);
    expect(DEFAULT_ESTIMATE_ALERTS).toEqual({ minutes: 10, popup: true, sound: false });
    expect(ALERT_CHIME_NOTES).toEqual({ near: 2, over: 3 });
  });

  it("reads the alert minutes as typed", () => {
    expect(parseEstimateAlertMinutes("")).toBeNull(); // blank switches warnings off
    expect(parseEstimateAlertMinutes("  ")).toBeNull();
    expect(parseEstimateAlertMinutes("15")).toBe(15);
    expect(parseEstimateAlertMinutes("1")).toBe(1);
    expect(parseEstimateAlertMinutes("480")).toBe(480);
    for (const bad of ["0", "481", "1.5", "abc", "-5", "1e2"]) expect(parseEstimateAlertMinutes(bad)).toBeUndefined();
  });

  it("shows how much of an estimate is used, rounded half up", () => {
    expect(utilisationPercent(90, 120)).toBe(75);
    expect(utilisationPercent(150, 120)).toBe(125);
    expect(utilisationPercent(0, 120)).toBe(0);
    expect(utilisationPercent(1, 3)).toBe(33);
    expect(utilisationPercent(2, 3)).toBe(67);
    expect(utilisationPercent(1, 8)).toBe(13);
    expect(utilisationPercent(10, null)).toBeNull();
    expect(utilisationPercent(10, 0)).toBeNull();
  });
});

describe("when a running timer raises a warning", () => {
  const base = {
    estimatedMinutes: 60 as number | null,
    loggedMinutes: 40,
    elapsedMs: 0,
    settings: DEFAULT_ESTIMATE_ALERTS,
    fired: new Set<EstimateStage>(),
  };
  const min = (n: number, s = 0) => n * 60_000 + s * 1000;

  it("stays quiet until fewer minutes than the threshold are left", () => {
    expect(alertToRaise({ ...base, elapsedMs: 0 })).toBeNull(); // 20 left
    expect(alertToRaise({ ...base, elapsedMs: min(10) })).toBeNull(); // exactly 10 left
    expect(alertToRaise({ ...base, elapsedMs: min(11) })).toBe("near"); // 9 left
  });

  it("counts whole minutes of the running timer only", () => {
    expect(elapsedWholeMinutes(min(10, 59))).toBe(10);
    expect(alertToRaise({ ...base, elapsedMs: min(10, 59) })).toBeNull();
    expect(elapsedWholeMinutes(-5)).toBe(0);
  });

  it("raises each stage once per timer", () => {
    expect(alertToRaise({ ...base, elapsedMs: min(15), fired: new Set(["near"]) })).toBeNull();
    expect(alertToRaise({ ...base, elapsedMs: min(20) })).toBe("over");
    expect(alertToRaise({ ...base, elapsedMs: min(20), fired: new Set(["near"]) })).toBe("over");
    expect(alertToRaise({ ...base, elapsedMs: min(25), fired: new Set(["near", "over"]) })).toBeNull();
  });

  it("raises only the stage reached when it jumps straight to over", () => {
    expect(alertToRaise({ ...base, loggedMinutes: 0, estimatedMinutes: 30, elapsedMs: min(31) })).toBe("over");
  });

  it("is off without an estimate, with warnings off, or with neither popup nor sound", () => {
    expect(alertToRaise({ ...base, estimatedMinutes: null, elapsedMs: min(500) })).toBeNull();
    expect(
      alertToRaise({ ...base, settings: { minutes: null, popup: true, sound: true }, elapsedMs: min(500) }),
    ).toBeNull();
    expect(
      alertToRaise({ ...base, settings: { minutes: 10, popup: false, sound: false }, elapsedMs: min(500) }),
    ).toBeNull();
    expect(alertToRaise({ ...base, settings: { minutes: 10, popup: false, sound: true }, elapsedMs: min(15) })).toBe(
      "near",
    );
  });

  it("counts logged minutes on the task, and a task already over warns at once", () => {
    expect(alertToRaise({ ...base, loggedMinutes: 70, elapsedMs: 0 })).toBe("over");
  });

  it("keeps a timer's raised stages under its own key", () => {
    expect(timerAlertStorageKey("abc")).toBe("work-estimate-alert:abc");
  });
});
