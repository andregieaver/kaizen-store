import { describe, expect, it } from "vitest";

import { balanceOf, bpsToPercent, cleanChannelUrl, CREATOR_MAX_BPS, percentToBps } from "./creators";
import { creatorApplicationInput, creatorPayoutInput, creatorSettingsInput } from "./creators-schema";

describe("creators' plain rules (D386)", () => {
  it("reads a percentage as the owner types it into basis points, within the programme's limit", () => {
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("12,5")).toBe(1250);
    expect(percentToBps(" 7.25 ")).toBe(725);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("50")).toBe(CREATOR_MAX_BPS);
    expect(percentToBps("51")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(percentToBps("-5")).toBeNull();
    expect(percentToBps("ten")).toBeNull();
    expect(bpsToPercent(1250)).toBe("12.5");
    expect(bpsToPercent(1000)).toBe("10");
  });

  it("keeps a channel only as a web address of its own, never a script or a password in it", () => {
    expect(cleanChannelUrl("https://video.example/@mia")).toBe("https://video.example/@mia");
    expect(cleanChannelUrl("http://blog.example")).toBe("http://blog.example/");
    expect(cleanChannelUrl("javascript:alert(1)")).toBeNull();
    expect(cleanChannelUrl("data:text/html,hi")).toBeNull();
    expect(cleanChannelUrl("https://user:secret@site.example")).toBeNull();
    expect(cleanChannelUrl("not a link")).toBeNull();
    expect(cleanChannelUrl(`https://site.example/${"a".repeat(300)}`)).toBeNull();
  });

  it("works out what is owed from what was earned, taken back and paid", () => {
    expect(balanceOf("EUR", 1000, 200, 300)).toEqual({ currency: "EUR", earnedMinor: 1000, reversedMinor: 200, paidMinor: 300, owedMinor: 500 });
  });

  it("checks the settings, the application and a payout as the server does", () => {
    expect(creatorSettingsInput.safeParse({ enabled: true, commissionBps: 1000, categoryBps: {}, cookieDays: 30 }).success).toBe(true);
    expect(creatorSettingsInput.safeParse({ enabled: true, commissionBps: 6000, categoryBps: {}, cookieDays: 30 }).success).toBe(false);
    expect(creatorSettingsInput.safeParse({ enabled: true, commissionBps: 1000, categoryBps: { x: 100 }, cookieDays: 30 }).success).toBe(false);
    expect(creatorSettingsInput.safeParse({ enabled: true, commissionBps: 1000, categoryBps: {}, cookieDays: 91 }).success).toBe(false);
    expect(creatorApplicationInput.safeParse({ name: "Mia", channelUrl: "https://a.example", consent: true }).success).toBe(true);
    expect(creatorApplicationInput.safeParse({ name: "Mia", channelUrl: "https://a.example", consent: false }).success).toBe(false);
    expect(creatorApplicationInput.safeParse({ name: " ", channelUrl: "https://a.example", consent: true }).success).toBe(false);
    expect(creatorPayoutInput.safeParse({ currency: "NOK", amountMinor: 100, paidOn: "2026-10-28", reference: "" }).success).toBe(true);
    expect(creatorPayoutInput.safeParse({ currency: "nok", amountMinor: 100, paidOn: "2026-10-28", reference: "" }).success).toBe(false);
    expect(creatorPayoutInput.safeParse({ currency: "NOK", amountMinor: 0, paidOn: "2026-10-28", reference: "" }).success).toBe(false);
  });
});
