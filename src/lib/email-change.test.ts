import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { staffEmailsNb } from "./admin-messages/staff-emails.nb";
import { staffEmailsEn } from "./admin-messages/staff-emails.en";
import { EMAIL_CHANGE_HOURS, NAME_MAX } from "./email-change-limits";
import { renderEmail } from "./email-layout";
import {
  cleanName,
  emailChangeEmail,
  emailChangeTokenHash,
  linkWorks,
  makeEmailChangeToken,
  maskEmail,
  newAddress,
} from "./email-change";

const fixed = (byte: number) => (length: number) => new Uint8Array(length).fill(byte);

describe("a person's name (D836)", () => {
  it("is kept as a person reads it: spaces around and in a row taken out, nothing unprinted", () => {
    expect(cleanName("  Ada   Lovelace ")).toEqual({ ok: true, name: "Ada Lovelace" });
    expect(cleanName("Ada\nLovelace\t")).toEqual({ ok: true, name: "Ada Lovelace" });
    expect(cleanName("Zoë​ Ørsted")).toEqual({ ok: true, name: "Zoë Ørsted" });
  });

  it("is never empty and never longer than the limit, counted in characters", () => {
    expect(cleanName("   ")).toEqual({ ok: false, problem: "empty" });
    expect(cleanName(null)).toEqual({ ok: false, problem: "empty" });
    expect(cleanName("å".repeat(NAME_MAX))).toEqual({ ok: true, name: "å".repeat(NAME_MAX) });
    expect(cleanName("a".repeat(NAME_MAX + 1))).toEqual({ ok: false, problem: "long" });
  });
});

describe("a new address", () => {
  it("is kept as the accounts compare it, and must be an address other than the account's", () => {
    expect(newAddress("  New@Example.COM ", "old@example.com")).toEqual({ ok: true, email: "new@example.com" });
    expect(newAddress("not an address", "old@example.com")).toEqual({ ok: false, problem: "invalid" });
    expect(newAddress("", "old@example.com")).toEqual({ ok: false, problem: "invalid" });
    expect(newAddress(`${"a".repeat(250)}@example.com`, "old@example.com")).toEqual({ ok: false, problem: "invalid" });
    expect(newAddress("OLD@example.com", "old@example.com")).toEqual({ ok: false, problem: "same" });
  });

  it("is shown half hidden to whoever reads the old address's mail", () => {
    expect(maskEmail("ada@example.com")).toBe("a•••@example.com");
    expect(maskEmail("nothing")).toBe("•••");
  });
});

describe("the link's token", () => {
  it("is 32 random bytes as base64url, and only its SHA-256 is kept", () => {
    const { token, hash } = makeEmailChangeToken(fixed(7));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toContain(token);
    expect(emailChangeTokenHash(token)).toBe(hash);
    expect(makeEmailChangeToken(fixed(8)).token).not.toBe(token);
  });

  it("asks nothing of the database for what cannot be a token", () => {
    expect(emailChangeTokenHash("short")).toBeNull();
    expect(emailChangeTokenHash(`${"a".repeat(42)}=`)).toBeNull();
    expect(emailChangeTokenHash(undefined)).toBeNull();
    expect(emailChangeTokenHash(["a".repeat(43)])).toBeNull();
    expect(() => makeEmailChangeToken(() => new Uint8Array(16))).toThrow();
  });

  it("works once, until its end", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(linkWorks({ expiresAt: "2026-11-21T12:00:00Z", usedAt: null }, now)).toBe(true);
    expect(linkWorks({ expiresAt: "2026-11-20T12:00:00Z", usedAt: null }, now)).toBe(false);
    expect(linkWorks({ expiresAt: "2026-11-21T12:00:00Z", usedAt: "2026-11-20T11:00:00Z" }, now)).toBe(false);
    expect(EMAIL_CHANGE_HOURS).toBe(24);
  });
});

describe("the emails of a change", () => {
  const facts = { person: "Ada", email: "new@example.com", when: "2026-11-20 12:00 UTC", byAdmin: false, url: "https://kaizenaflow.com/admin/account/email/confirm?token=t" };

  it("sends the new address its link, saying how long it works and that it signs nobody in", () => {
    const email = renderEmail(emailChangeEmail("confirm", facts, staffEmailsEn));
    expect(email.subject).toBe("Confirm your new email address for Kaizena Flow");
    expect(email.text).toContain("new@example.com");
    expect(email.text).toContain(facts.url);
    expect(email.text).toContain("24 hours");
    expect(email.text).toContain("does not sign you in");
    expect(renderEmail(emailChangeEmail("confirm", { ...facts, byAdmin: true }, staffEmailsEn)).text).toContain("Kaizena Flow admin asked, for you");
  });

  it("tells the old address what was asked and what was done, with no link but the sign-in page", () => {
    const asked = renderEmail(emailChangeEmail("requested", { ...facts, email: "n•••@example.com", url: "https://kaizenaflow.com/admin/sign-in" }, staffEmailsEn));
    expect(asked.text).toContain("n•••@example.com");
    expect(asked.text).toContain("cancel the change");
    expect(asked.text).not.toContain("token=");
    const done = renderEmail(emailChangeEmail("changed", { ...facts, email: "n•••@example.com", url: "https://kaizenaflow.com/admin/sign-in" }, staffEmailsEn));
    expect(done.subject).toBe("Your Kaizena Flow email address was changed");
    expect(done.text).toContain("If this was not you");
  });

  it("is written in the person's admin language", () => {
    const email = emailChangeEmail("confirm", facts, staffEmailsNb, "nb");
    expect(email.lang).toBe("nb");
    expect(email.subject).toBe("Bekreft den nye e-postadressen din hos Kaizena Flow");
    expect(renderEmail(email).text).toContain("24 timer");
  });
});
