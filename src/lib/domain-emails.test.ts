import { describe, expect, it } from "vitest";

import { domainEmail, reminderDue } from "./domain-emails";

describe("domain renewal reminders (D315 9.1)", () => {
  it("are due at 30, 14, 7 and 1 days, a missed day caught up once", () => {
    expect(reminderDue(45)).toBeNull();
    expect(reminderDue(30)).toBe(30);
    expect(reminderDue(20)).toBe(30);
    expect(reminderDue(14)).toBe(14);
    expect(reminderDue(8)).toBe(14);
    expect(reminderDue(7)).toBe(7);
    expect(reminderDue(1)).toBe(1);
    expect(reminderDue(0)).toBe(1);
    expect(reminderDue(-1)).toBeNull();
  });
});

describe("the registered email (D317)", () => {
  it("repeats a consumer's consent, in their language, and names nothing else of the purchase", () => {
    const email = domainEmail("registered", "nb", { domain: "kari.no", date: "1. januar 2028", holder: "Kari Nordmann", consent: "Jeg ber Kaizena Flow …", url: "https://x/admin/account/domains" });
    expect(email.subject).toBe("kari.no er ditt");
    expect(JSON.stringify(email.blocks)).toContain("Jeg ber Kaizena Flow");
    const business = domainEmail("registered", "en", { domain: "acme.com", date: "1 January 2028", holder: "Acme AS", consent: null, url: "https://x" });
    expect(JSON.stringify(business.blocks)).not.toContain("withdrawn");
  });
});
