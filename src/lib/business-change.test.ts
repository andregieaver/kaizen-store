import { describe, expect, it } from "vitest";

import { businessChangeMissing, businessChangeWhen, cleanBusinessChange } from "./business-change";

const store = { country: "NO", today: "2026-11-06", organisationNumber: "915262341" };
const base = { legalName: "Human Web AS", businessForm: "as", startsOn: "2027-01-01" };

describe("a change of the business behind a store", () => {
  it("is what the owner typed, checked: the number, the VAT number written for a Norwegian business, the day, the prefixes", () => {
    const made = cleanBusinessChange({ ...base, organisationNumber: "923 609 016", vatRegistered: "on", prefixes: { invoice: "AS-F-", work_invoice: "", credit_note: " " } }, store);
    expect(made).toEqual({
      ok: true,
      change: {
        legalName: "Human Web AS",
        businessForm: "as",
        organisationNumber: "923609016",
        vatRegistered: true,
        vatNumber: "NO923609016MVA",
        postalAddress: null,
        startsOn: "2027-01-01",
        prefixes: { invoice: "AS-F-" },
      },
    });
  });

  it("may be planned before the new business has its number, and then waits for it", () => {
    const made = cleanBusinessChange({ ...base, vatRegistered: true }, store);
    if (!made.ok) throw new Error(made.problems.join());
    expect(made.change).toMatchObject({ organisationNumber: null, vatRegistered: true, vatNumber: null });
    expect(businessChangeMissing(made.change)).toEqual(["organisation_number", "vat_number"]);
    expect(businessChangeMissing({ organisationNumber: "923609016", vatRegistered: false, vatNumber: null })).toEqual([]);
  });

  it("says what is wrong: a bad number, the business it already is, a day that is not after today, a prefix out of shape", () => {
    expect(cleanBusinessChange({ ...base, organisationNumber: "923609017" }, store)).toEqual({ ok: false, problems: ["organisation_number"] });
    expect(cleanBusinessChange({ ...base, organisationNumber: "915 262 341" }, store)).toEqual({ ok: false, problems: ["same"] });
    expect(cleanBusinessChange({ ...base, startsOn: "2026-11-06" }, store)).toEqual({ ok: false, problems: ["starts_on"] });
    expect(cleanBusinessChange({ ...base, startsOn: "2031-01-01" }, store)).toEqual({ ok: false, problems: ["starts_on"] });
    expect(cleanBusinessChange({ ...base, prefixes: { invoice: "far too long a prefix" } }, store)).toEqual({ ok: false, problems: ["prefix"] });
    expect(cleanBusinessChange({ legalName: "", businessForm: "llc", startsOn: "soon", vatRegistered: true, vatNumber: "SE123" }, store)).toEqual({
      ok: false,
      problems: ["legal_name", "form", "vat_number", "starts_on"],
    });
  });

  it("knows how far off its day is", () => {
    expect(businessChangeWhen("2027-01-01", "2026-12-30")).toEqual({ kind: "ahead", days: 2 });
    expect(businessChangeWhen("2027-01-01", "2027-01-01")).toEqual({ kind: "today" });
    expect(businessChangeWhen("2027-01-01", "2027-01-04")).toEqual({ kind: "overdue", days: 3 });
  });
});
