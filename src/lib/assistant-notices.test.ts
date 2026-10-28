import { describe, expect, it } from "vitest";

import { assistantEn } from "./admin-messages/assistant.en";
import { assistantNb } from "./admin-messages/assistant.nb";
import { NOTICE_KINDS, noticeText, noticeWordKey } from "./assistant-notices";

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
  });
});
