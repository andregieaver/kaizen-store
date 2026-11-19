import { describe, expect, it } from "vitest";

import { staffEmailsNb } from "./admin-messages/staff-emails.nb";
import { GUARD_MIN_SENT, guardVerdict, pausedEmail, shareText } from "./sending-guard";

describe("the sending guard's verdict (D730)", () => {
  it("judges nothing below the smallest send", () => {
    expect(guardVerdict({ sent: GUARD_MIN_SENT - 1, bounced: 50, complained: 10 })).toEqual({ level: "ok" });
  });

  it("pauses at 5 % bounces or 0.3 % spam reports, complaints first", () => {
    expect(guardVerdict({ sent: 1000, bounced: 50, complained: 0 })).toEqual({ level: "pause", reason: "bounces" });
    expect(guardVerdict({ sent: 1000, bounced: 49, complained: 0 })).toEqual({ level: "warn", reason: "bounces" });
    expect(guardVerdict({ sent: 1000, bounced: 0, complained: 3 })).toEqual({ level: "pause", reason: "complaints" });
    expect(guardVerdict({ sent: 1000, bounced: 80, complained: 3 })).toEqual({ level: "pause", reason: "complaints" });
  });

  it("warns near the line, and says nothing below it", () => {
    expect(guardVerdict({ sent: 1000, bounced: 0, complained: 1 })).toEqual({ level: "warn", reason: "complaints" });
    expect(guardVerdict({ sent: 1000, bounced: 20, complained: 0 })).toEqual({ level: "warn", reason: "bounces" });
    expect(guardVerdict({ sent: 1000, bounced: 19, complained: 0 })).toEqual({ level: "ok" });
  });

  it("writes a share as the owner reads it", () => {
    expect(shareText(52, 1000)).toBe("5.2 %");
    expect(shareText(3, 1000)).toBe("0.3 %");
    expect(shareText(31, 10000, "nb-NO")).toBe("0,31 %");
    expect(shareText(1, 0)).toBe("0 %");
  });
});

describe("the email to the owners", () => {
  const facts = { storeName: "Nordlys Te", timeZone: "Europe/Oslo", reason: "bounces" as const, counts: { sent: 1200, bounced: 84, complained: 1 }, since: new Date("2026-11-10T00:00:00Z"), url: "https://kaizenaflow.com/admin/nordlys/marketing" };

  it("says what was counted, what is held and what goes on", () => {
    const email = pausedEmail(facts);
    expect(email.subject).toBe("Marketing email from Nordlys Te is paused");
    const text = email.blocks.map((b) => ("text" in b ? b.text : "")).join("\n");
    expect(text).toContain("84 of the 1,200 marketing emails Nordlys Te sent since 10 November 2026 bounced back (7 %).");
    expect(text).toContain("Order emails, receipts and tracking go on as before.");
    expect(email.blocks.at(-1)).toEqual({ type: "button", text: "See it and resume", url: facts.url });
  });

  it("is written in the owner's language", () => {
    const email = pausedEmail({ ...facts, reason: "complaints", counts: { sent: 1000, bounced: 0, complained: 4 } }, staffEmailsNb, "nb");
    expect(email.subject).toBe("Markedsførings-e-post fra Nordlys Te er satt på pause");
    expect(email.blocks[1]).toMatchObject({ type: "paragraph" });
    expect("text" in email.blocks[1] && email.blocks[1].text).toContain("ble merket som søppelpost (0,4 %)");
  });
});
