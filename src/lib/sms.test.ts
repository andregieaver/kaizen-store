import { describe, expect, it } from "vitest";

import {
  campaignEstimate,
  isStopReply,
  maskedPhone,
  nextSendTime,
  normalisePhone,
  phoneCountry,
  smsBody,
  smsParts,
  smsSettingsInput,
  withinCap,
} from "./sms";

describe("phone numbers (D565)", () => {
  it("are made E.164 from what people type, in their own country or with its code", () => {
    expect(normalisePhone("912 34 567", "NO")).toBe("+4791234567");
    expect(normalisePhone("+47 912 34 567", null)).toBe("+4791234567");
    expect(normalisePhone("0047 91234567", "SE")).toBe("+4791234567");
    expect(normalisePhone("070-123 45 67", "SE")).toBe("+46701234567");
    expect(normalisePhone("(0)6 12 34 56 78", "FR")).toBe("+33612345678");
    expect(normalisePhone("333 1234567", "IT")).toBe("+393331234567");
  });

  it("refuse what is not a number of a country a store may text", () => {
    expect(normalisePhone("", "NO")).toBeNull();
    expect(normalisePhone("call me", "NO")).toBeNull();
    expect(normalisePhone("12", "NO")).toBeNull();
    expect(normalisePhone("+1 212 555 0100", null)).toBeNull();
    expect(normalisePhone("91234567", null)).toBeNull();
    expect(normalisePhone("+47+91234567", null)).toBeNull();
  });

  it("know their country by the longest calling code, and show staff only its end", () => {
    expect(phoneCountry("+358401234567")).toBe("FI");
    expect(phoneCountry("+35312345678")).toBe("IE");
    expect(phoneCountry("+4791234567")).toBe("NO");
    expect(phoneCountry("+12125550100")).toBeNull();
    expect(maskedPhone("+4791234567")).toBe("+47 ••• 567");
  });
});

describe("stopping", () => {
  it("takes a reply whose first word is a stop word, in any case", () => {
    for (const reply of ["STOP", "stopp", "Avslutt", " sluta ", "STOPP takk", "Stop."]) expect(isStopReply(reply), reply).toBe(true);
    for (const reply of ["Hei", "Don't stop", "stopwatch", ""]) expect(isStopReply(reply), reply).toBe(false);
  });
});

describe("a text's parts", () => {
  it("count 160 GSM characters to one part, 153 a part beyond, and the extension's characters twice", () => {
    expect(smsParts("a".repeat(160))).toMatchObject({ parts: 1, unicode: false });
    expect(smsParts("a".repeat(161)).parts).toBe(2);
    expect(smsParts("a".repeat(306)).parts).toBe(2);
    expect(smsParts("a".repeat(307)).parts).toBe(3);
    expect(smsParts("€".repeat(80))).toMatchObject({ parts: 1, length: 160 });
    expect(smsParts("Hei på deg, Ærlig Øl").unicode).toBe(false);
  });

  it("count a Unicode text 70 to one part and 67 beyond", () => {
    expect(smsParts("Ш".repeat(70))).toMatchObject({ parts: 1, unicode: true });
    expect(smsParts("Ш".repeat(71)).parts).toBe(2);
    expect(smsParts("Hi 🎉").unicode).toBe(true);
  });

  it("carry the store's name first and the stop link last, in the recipient's language", () => {
    expect(smsBody({ storeName: "Nordlys", text: " 20 % på alt i dag. ", stopUrl: "https://x.example/sms/abc", lang: "nb" })).toBe(
      "Nordlys: 20 % på alt i dag.\nAvmeld: https://x.example/sms/abc",
    );
    expect(smsBody({ storeName: "Nordlys", text: "Hi", stopUrl: "u", lang: "fi" })).toBe("Nordlys: Hi\nUnsubscribe: u");
  });
});

describe("quiet hours", () => {
  it("send at once within the recipient's hours, else at the next opening of them, in their own time zone", () => {
    // 10:00 in Oslo (UTC+1 in November).
    const morning = new Date("2026-11-11T09:00:00Z");
    expect(nextSendTime(morning, "NO")).toEqual(morning);
    // 22:30 in Oslo: tomorrow at 09:00 Oslo time, 08:00 UTC.
    expect(nextSendTime(new Date("2026-11-11T21:30:00Z"), "NO")).toEqual(new Date("2026-11-12T08:00:00Z"));
    // 06:00 in Helsinki (UTC+2): today at 09:00 there.
    expect(nextSendTime(new Date("2026-11-11T04:00:00Z"), "FI")).toEqual(new Date("2026-11-11T07:00:00Z"));
    // Owner's narrower hours: 12 to 18.
    expect(nextSendTime(morning, "NO", { from: 12, until: 18 })).toEqual(new Date("2026-11-11T11:00:00Z"));
  });

  it("follow summer time: 09:00 in Oslo is 07:00 UTC in July", () => {
    expect(nextSendTime(new Date("2026-07-01T03:00:00Z"), "NO")).toEqual(new Date("2026-07-01T07:00:00Z"));
  });

  it("keep France's Sundays free of offers: Sunday morning waits for Monday at 09:00 Paris time", () => {
    // Sunday 15 November 2026, 10:00 in Paris.
    expect(nextSendTime(new Date("2026-11-15T09:00:00Z"), "FR")).toEqual(new Date("2026-11-16T08:00:00Z"));
    // Saturday 21:00 in Paris: Monday 09:00, not Sunday.
    expect(nextSendTime(new Date("2026-11-14T20:00:00Z"), "FR")).toEqual(new Date("2026-11-16T08:00:00Z"));
    // Norway texts on a Sunday.
    expect(nextSendTime(new Date("2026-11-15T09:00:00Z"), "NO")).toEqual(new Date("2026-11-15T09:00:00Z"));
  });

  it("never let an owner allow the night", () => {
    expect(smsSettingsInput.safeParse({ sender: "Nordlys", quietFrom: 6 }).success).toBe(false);
    expect(smsSettingsInput.safeParse({ sender: "Nordlys", quietUntil: 23 }).success).toBe(false);
    expect(smsSettingsInput.safeParse({ sender: "Nordlys AS" }).success).toBe(false);
    expect(smsSettingsInput.safeParse({ sender: "Nordlys" }).success).toBe(true);
  });
});

describe("cost", () => {
  it("is each country's price times its recipients and the parts, and a campaign that would pass the month's cap does not start", () => {
    const estimate = campaignEstimate(new Map([["NO", 5000], ["SE", 3500]]), new Map([["NO", 10], ["SE", 4]]), 2);
    expect(estimate).toBe(5000 * 10 * 2 + 3500 * 4 * 2);
    expect(withinCap(0, estimate, 128_000)).toBe(true);
    expect(withinCap(1, estimate, 128_000)).toBe(false);
  });
});
