import { describe, expect, it } from "vitest";

import { assistantEn } from "./admin-messages/assistant.en";
import { assistantNb } from "./admin-messages/assistant.nb";
import { NOTICE_KINDS, noticeText, noticeWait, noticeWordKey } from "./assistant-notices";

describe("the AI manager's notices (D350)", () => {
  it("has words for every kind in English and Norwegian", () => {
    for (const kind of NOTICE_KINDS) {
      expect(assistantEn.notices.kinds[kind], kind).toBeTruthy();
      expect(assistantNb.notices.kinds[kind], kind).toBeTruthy();
    }
  });

  it("fills a notice's words from its facts, leaving out a missing one", () => {
    expect(noticeText(assistantEn.notices.kinds.page_built, { title: "About us" })).toBe("Built the page About us");
    expect(noticeText("{plan} asks you: {step}", { plan: "Launch" })).toBe("Launch asks you:");
  });

  it("chooses the failure's words where a build or follow-up did not succeed", () => {
    expect(noticeWordKey("page_built", { title: "About" })).toBe("page_built");
    expect(noticeWordKey("page_built", { problem: "No model" })).toBe("page_failed");
    expect(noticeWordKey("follow_up", { task: "x", outcome: "failed" })).toBe("follow_up_failed");
    expect(noticeWordKey("follow_up", { task: "x", outcome: "done" })).toBe("follow_up");
    // An autopilot test of its change (E4.1): live, or the page kept as it was.
    expect(noticeWordKey("test_decided", { page: "About", outcome: "live" })).toBe("test_decided");
    expect(noticeWordKey("test_decided", { page: "About", outcome: "kept" })).toBe("test_kept");
    expect(assistantEn.notices.kinds.test_kept).toBeTruthy();
    expect(assistantNb.notices.kinds.test_kept).toBeTruthy();
  });
});

describe("how often an open tab asks", () => {
  it("asks every ten minutes when idle, every minute while waiting or lately active", () => {
    expect(noticeWait({ now: 0, activeAt: null, waiting: false })).toBe(600000);
    expect(noticeWait({ now: 0, activeAt: null, waiting: true })).toBe(60000);
    expect(noticeWait({ now: 599_999, activeAt: 0, waiting: false })).toBe(60000);
    expect(noticeWait({ now: 600_000, activeAt: 0, waiting: false })).toBe(600000);
  });

  it("asks at most twice in ten minutes and six times in an hour from an untouched tab", () => {
    const asks = (waiting: boolean, until: (t: number) => boolean) => {
      let t = 0;
      let n = 0;
      while (until(t)) {
        n += 1;
        t += noticeWait({ now: t, activeAt: null, waiting });
      }
      return n;
    };
    expect(asks(false, (t) => t <= 600_000)).toBeLessThanOrEqual(2);
    expect(asks(false, (t) => t < 3_600_000)).toBeLessThanOrEqual(6);
    expect(asks(true, (t) => t < 3_600_000)).toBe(60);
  });
});
