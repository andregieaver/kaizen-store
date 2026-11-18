import { describe, expect, it } from "vitest";

import { officerSummary, readOfficerChoice } from "./privacy-officer";

/** The data protection officer's form, read (D763): nobody, the account's, a person on the team or someone else, with words for problems. */

describe("reading the data protection officer's form (D763)", () => {
  it("reads nobody for an account, and the account's for a store, never the other way round", () => {
    expect(readOfficerChoice({ officer: "none" }, { store: false })).toEqual({ ok: true, choice: { kind: "none" } });
    expect(readOfficerChoice({ officer: "account" }, { store: true })).toEqual({ ok: true, choice: { kind: "account" } });
    expect(readOfficerChoice({ officer: "account" }, { store: false }).ok).toBe(false);
    expect(readOfficerChoice({ officer: "none" }, { store: true }).ok).toBe(false);
  });

  it("reads a person on the team by their account", () => {
    expect(readOfficerChoice({ officer: "staff:11111111-1111-4111-8111-11111111111A" }, { store: false })).toEqual({
      ok: true,
      choice: { kind: "staff", accountId: "11111111-1111-4111-8111-11111111111a" },
    });
  });

  it("reads someone else, with a name and an address, and asks for what is missing", () => {
    expect(readOfficerChoice({ officer: "person", name: " Ola Ombud ", email: "dpo@firm.example", phone: "", firm: "Firm AS" }, { store: true })).toEqual({
      ok: true,
      choice: { kind: "person", name: "Ola Ombud", email: "dpo@firm.example", phone: null, firm: "Firm AS" },
    });
    expect(readOfficerChoice({ officer: "person", name: "", email: "nope" }, { store: false })).toEqual({
      ok: false,
      problems: ["Write the officer's name.", "Write the officer's email address."],
    });
    expect(readOfficerChoice({}, { store: false })).toEqual({ ok: false, problems: ["Choose who the data protection officer is."] });
  });

  it("sums an officer up in one line", () => {
    expect(officerSummary({ name: "Ola Ombud", email: "dpo@firm.example", phone: null, firm: "Firm AS", staff: false })).toBe("Ola Ombud, Firm AS, dpo@firm.example");
    expect(officerSummary({ name: null, email: "dpo@firm.example", phone: null, firm: null, staff: true })).toBe("dpo@firm.example");
  });
});
