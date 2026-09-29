import { describe, expect, it } from "vitest";

import { numberSeriesInput, workSettingsInput } from "./work-input";
import {
  DEFAULT_WORK_SETTINGS,
  changedSettings,
  documentNumberOf,
  sellerReadiness,
  seriesFromForm,
  seriesInputProblem,
  settingsFromForm,
} from "./work-settings";
import type { SellerDetails } from "./work-vat";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const seller: SellerDetails = {
  legalName: "Konsulent AS",
  organisationNumber: "923456789",
  postalAddress: "Storgata 1, 0155 Oslo",
  country: "NO",
  vatRegistered: true,
  vatNumber: "NO923456789MVA",
  bankAccount: "NO9386011117947",
};

describe("the settings form, as the schema reads it", () => {
  it("turns a filled form into valid settings", () => {
    const parsed = workSettingsInput.parse(
      settingsFromForm(
        form({
          vatRegistered: "on",
          vatNumber: "no 923 456 789 mva",
          defaultPaymentDays: "30",
          defaultCurrency: "EUR",
          bankAccount: "NO9386011117947",
          bic: "dnbanokk",
          paymentNote: " Use KID ",
          estimateAlertMinutes: "15",
          estimateAlertPopup: "on",
        }),
      ),
    );
    expect(parsed).toMatchObject({
      vatRegistered: true,
      vatNumber: "NO923456789MVA",
      defaultPaymentDays: 30,
      defaultCurrency: "EUR",
      bic: "DNBANOKK",
      paymentNote: "Use KID",
      estimateAlertMinutes: 15,
      estimateAlertPopup: true,
      estimateAlertSound: false,
      showTimeNotesToClients: false,
      invoiceFooter: null,
    });
  });

  it("takes an empty warning field as no warnings, an empty currency as the store's own", () => {
    const parsed = workSettingsInput.parse(
      settingsFromForm(form({ defaultPaymentDays: "14", estimateAlertMinutes: "  " })),
    );
    expect(parsed.estimateAlertMinutes).toBeNull();
    expect(parsed.defaultCurrency).toBeNull();
  });

  it("gives a store that is not registered no VAT number", () => {
    const fields = settingsFromForm(form({ vatNumber: "NO923456789MVA", defaultPaymentDays: "14" }));
    expect(fields.vatRegistered).toBe(false);
    expect(workSettingsInput.parse(fields).vatNumber).toBeNull();
  });

  it("says what is wrong instead of guessing", () => {
    const bad = (fields: Record<string, string>) => {
      const result = workSettingsInput.safeParse(settingsFromForm(form({ defaultPaymentDays: "14", ...fields })));
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(bad({ defaultPaymentDays: "0" })).toContain("Payment terms are 1 to 90 days.");
    expect(bad({ defaultPaymentDays: "soon" })).toContain("Payment terms are 1 to 90 days.");
    expect(bad({ bankAccount: "NO9386011117948" })).toContain("The IBAN is not right. Check it against your bank's.");
    expect(bad({ bic: "12" })).toContain("A BIC is 8 or 11 letters and digits.");
    expect(bad({ estimateAlertMinutes: "999" }).length).toBe(1);
    expect(bad({ defaultCurrency: "XXX" })).toContain("Choose a currency.");
  });

  it("starts a store registered for VAT with 14 days and warnings on", () => {
    expect(DEFAULT_WORK_SETTINGS).toMatchObject({
      vatRegistered: true,
      defaultPaymentDays: 14,
      estimateAlertMinutes: 10,
    });
  });

  it("lists the settings that changed, by name only", () => {
    const after = { ...DEFAULT_WORK_SETTINGS, bankAccount: "NO9386011117947", defaultPaymentDays: 30 };
    expect(changedSettings(DEFAULT_WORK_SETTINGS, after).sort()).toEqual(["bankAccount", "defaultPaymentDays"]);
    expect(changedSettings(after, after)).toEqual([]);
  });
});

describe("what is missing before an invoice", () => {
  it("is nothing for a complete registered seller", () => {
    expect(sellerReadiness(seller)).toEqual({ ready: true, problems: [] });
  });

  it("lists every missing detail of a store that has set nothing up, with where to fix it", () => {
    const empty: SellerDetails = {
      legalName: null,
      organisationNumber: null,
      postalAddress: null,
      country: null,
      vatRegistered: true,
      vatNumber: null,
      bankAccount: null,
    };
    const { ready, problems } = sellerReadiness(empty);
    expect(ready).toBe(false);
    expect(problems.map((p) => [p.code, p.where])).toEqual([
      ["seller_legal_name", "company"],
      ["seller_organisation_number", "company"],
      ["seller_address", "company"],
      ["seller_country", "company"],
      ["seller_vat_number", "settings"],
      ["seller_bank_account", "settings"],
    ]);
    expect(problems.every((p) => p.severity === "error")).toBe(true);
  });

  it("asks for no VAT number from a store that is not registered", () => {
    expect(sellerReadiness({ ...seller, vatRegistered: false, vatNumber: null })).toEqual({
      ready: true,
      problems: [],
    });
  });

  it("checks the IBAN, and warns about a VAT number that looks wrong without blocking", () => {
    const badIban = sellerReadiness({ ...seller, bankAccount: "NO9386011117948" });
    expect(badIban.ready).toBe(false);
    expect(badIban.problems.map((p) => p.code)).toEqual(["seller_bank_account_invalid"]);
    const badVat = sellerReadiness({ ...seller, vatNumber: "12" });
    expect(badVat.ready).toBe(true);
    expect(badVat.problems.map((p) => [p.code, p.severity])).toEqual([["seller_vat_number_format", "warning"]]);
  });

  it("leaves the client and the lines to the invoice", () => {
    for (const registered of [true, false]) {
      const codes = sellerReadiness({ ...seller, vatRegistered: registered, country: null }).problems.map(
        (p) => p.code,
      );
      expect(codes).toEqual(["seller_country"]);
    }
  });
});

describe("numbering", () => {
  it("prints the prefix and the number", () => {
    expect(documentNumberOf("W-", 42)).toBe("W-42");
    expect(documentNumberOf("", 7)).toBe("7");
  });

  it("reads a series form", () => {
    const parsed = numberSeriesInput.parse(
      seriesFromForm("work_invoice", form({ prefix: " 2026- ", nextNumber: "101" })),
    );
    expect(parsed).toEqual({ series: "work_invoice", prefix: "2026-", nextNumber: 101 });
    expect(
      numberSeriesInput.safeParse(seriesFromForm("work_invoice", form({ prefix: "", nextNumber: "0" }))).success,
    ).toBe(false);
    expect(numberSeriesInput.safeParse(seriesFromForm("orders", form({ prefix: "", nextNumber: "1" }))).success).toBe(
      false,
    );
    expect(
      numberSeriesInput.safeParse(seriesFromForm("work_invoice", form({ prefix: "a b", nextNumber: "1" }))).success,
    ).toBe(false);
  });

  it("refuses a prefix the database would (up to 10 characters)", () => {
    expect(seriesInputProblem({ series: "work_invoice", prefix: "ABCDEFGHIJ", nextNumber: 1 })).toBeNull();
    expect(seriesInputProblem({ series: "work_invoice", prefix: "ABCDEFGHIJK", nextNumber: 1 })).toMatch(/up to 10/);
  });
});
