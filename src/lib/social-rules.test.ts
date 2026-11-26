import { describe, expect, it } from "vitest";

import { autonomyDecision, DEFAULT_AUTONOMY } from "./autopilot-autonomy";
import { DEFAULT_SOCIAL_RULES, inQuietHours, localHour, quietEnds, readSocialRules, rulesProblem } from "./social-rules";

/** *Post on its own within my rules* (D870 S3.3): off by default, the quiet hours across midnight, and what keeps a post for a person. */

describe("the owner's rules for posting", () => {
  it("is off unless switched on, and reads anything else as off", () => {
    expect(DEFAULT_SOCIAL_RULES).toEqual({ on: false, by: null, postsPerDay: 1, quietFrom: 21, quietTo: 8 });
    expect(readSocialRules({ on: true, postsPerDay: 99 })).toEqual(DEFAULT_SOCIAL_RULES);
    expect(readSocialRules(null).on).toBe(false);
  });

  it("knows the quiet hours, across midnight or within a day, and none when they are equal", () => {
    const night = { quietFrom: 21, quietTo: 8 };
    expect([20, 21, 23, 0, 7, 8].map((h) => inQuietHours(h, night))).toEqual([false, true, true, true, true, false]);
    expect([11, 12, 13].map((h) => inQuietHours(h, { quietFrom: 12, quietTo: 13 }))).toEqual([false, true, false]);
    expect(inQuietHours(3, { quietFrom: 5, quietTo: 5 })).toBe(false);
  });

  it("says when the quiet hours end in the store's time, today or tomorrow", () => {
    const rules = { quietFrom: 21, quietTo: 8 };
    expect(localHour(new Date("2030-05-03T20:30:00Z"), "Europe/Oslo")).toBe(22);
    expect(quietEnds(new Date("2030-05-03T20:30:00Z"), "Europe/Oslo", rules)?.toISOString()).toBe("2030-05-04T06:00:00.000Z");
    expect(quietEnds(new Date("2030-05-04T03:00:00Z"), "Europe/Oslo", rules)?.toISOString()).toBe("2030-05-04T06:00:00.000Z");
    expect(quietEnds(new Date("2030-05-04T09:00:00Z"), "Europe/Oslo", rules)).toBeNull();
  });

  it("keeps a held, unchecked, failed or unsellable post for a person", () => {
    const ok = { checked: true, problems: [], held: false, product: { active: true, canBuy: true } };
    expect(rulesProblem(ok)).toBeNull();
    expect(rulesProblem({ ...ok, product: null })).toBeNull();
    expect(rulesProblem({ ...ok, held: true })).toContain("took it off");
    expect(rulesProblem({ ...ok, checked: false })).toContain("not been checked");
    expect(rulesProblem({ ...ok, problems: ["cut_off"] })).toContain("picture check");
    expect(rulesProblem({ ...ok, product: { active: false, canBuy: true } })).toContain("not on sale");
    expect(rulesProblem({ ...ok, product: { active: true, canBuy: false } })).toContain("sold out");
  });

  it("lets the autopilot post only by the rules, whatever the marketing level", () => {
    const asking = { ...DEFAULT_AUTONOMY, levels: { marketing: "ask" as const } };
    expect(autonomyDecision(asking, "publish_social_post", "public", { socialProblem: null })).toEqual({ run: true, tell: true, area: "marketing" });
    expect(autonomyDecision({ ...DEFAULT_AUTONOMY, levels: { marketing: "auto" } }, "publish_social_post", "public", { socialProblem: "Posting on its own is off." })).toEqual({
      run: false,
      why: "Posting on its own is off.",
    });
    expect(autonomyDecision(DEFAULT_AUTONOMY, "publish_social_post", "public")).toMatchObject({ run: false });
  });
});
