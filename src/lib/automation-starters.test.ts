import { describe, expect, it } from "vitest";

import { AUTOMATION_STARTERS, starterContent } from "./automation-starters";
import { DELAY_RANGES, LIFECYCLE_KINDS } from "./automation-kinds";
import { automationInput } from "./automations";
import { broadcastContentSchema, sendProblems } from "./broadcasts";
import { findClaims } from "./claims";
import { isRequestAddress } from "./stock-request-check";

/** The lifecycle automations' starting words and settings (D298, `docs/wave-5-marketing.md` 6.1 and 6.4). */

describe("starters", () => {
  it("exist for every kind in Norwegian, Swedish, Danish and English, make no claims and can be sent", () => {
    for (const kind of LIFECYCLE_KINDS) {
      expect(Object.keys(AUTOMATION_STARTERS[kind]).sort()).toEqual(["da", "en", "nb", "sv"]);
      for (const starter of Object.values(AUTOMATION_STARTERS[kind])) {
        for (const text of [starter.subject, starter.preview, starter.heading, starter.text, starter.button]) expect(findClaims(text)).toEqual([]);
      }
      const content = starterContent(kind, ["nb-NO", "en-GB", "de-DE"]);
      expect(Object.keys(content)).toEqual(["nb-NO", "en-GB"]);
      expect(broadcastContentSchema.safeParse(content).success).toBe(true);
      expect(sendProblems(content, "nb-NO")).toEqual([]);
    }
  });
});

describe("settings", () => {
  it("keep each kind's days in its range", () => {
    for (const kind of LIFECYCLE_KINDS) {
      const { min, max, start } = DELAY_RANGES[kind];
      const at = (delayDays: number) => automationInput(kind).safeParse({ delayDays, content: {} }).success;
      expect([at(min), at(max), at(start), at(min - 1), at(max + 1), at(min + 0.5)]).toEqual([true, true, true, false, false, false]);
    }
  });
});

describe("a back-in-stock address", () => {
  it("is a whole address", () => {
    expect(["kari@example.com", " kari@example.no "].map(isRequestAddress)).toEqual([true, true]);
    expect(["", "kari", "kari@example", "ka ri@example.com", `${"a".repeat(250)}@example.com`].map(isRequestAddress)).toEqual([false, false, false, false, false]);
  });
});
