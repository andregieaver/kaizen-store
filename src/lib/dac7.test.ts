import { describe, expect, it } from "vitest";

import { decimalAmount, ibanValid, quarterOf, taxDetailsInput, toCsv } from "./dac7";

const person = {
  kind: "individual",
  legalName: "Kari Nordmann",
  dateOfBirth: "1980-05-17",
  address: "Storgata 1, 0155 Oslo",
  country: "no",
  tin: "010 180 12345",
  tinCountry: "NO",
  vatNumber: "",
  businessNumber: "",
  iban: "no93 8601 1117 947",
};

describe("DAC7 details (D71)", () => {
  it("checks an IBAN's check digits", () => {
    expect(ibanValid("NO9386011117947")).toBe(true);
    expect(ibanValid("NO9386011117948")).toBe(false);
    expect(ibanValid("DE89370400440532013000")).toBe(true);
    expect(ibanValid("not an iban")).toBe(false);
  });

  it("tidies what a host types, and asks a person for their birth date and a business for its number", () => {
    const parsed = taxDetailsInput.parse(person);
    expect(parsed).toMatchObject({ country: "NO", tin: "01018012345", iban: "NO9386011117947", dateOfBirth: "1980-05-17" });

    const problems = (values: Record<string, unknown>) => {
      const result = taxDetailsInput.safeParse(values);
      return result.success ? [] : result.error.issues.map((i) => i.message);
    };
    expect(problems({ ...person, dateOfBirth: "" })).toEqual(["Give your date of birth."]);
    expect(problems({ ...person, kind: "entity", dateOfBirth: "" })).toEqual(["Write your business's registration number."]);
    expect(problems({ ...person, kind: "entity", dateOfBirth: "", businessNumber: "999 999 999" })).toEqual([]);
    expect(problems({ ...person, iban: "NO9386011117948" })).toEqual(["The IBAN is not right. Check it against your bank's."]);
    // No bank account is fine: Stripe has it.
    expect(problems({ ...person, iban: "" })).toEqual([]);
    expect(problems({ ...person, country: "Norway", tin: "1" })).toEqual([
      "Choose the country you live in, or where your business is.",
      "Write your tax identification number.",
    ]);
  });

  it("puts a payment in the quarter it was made where the store is", () => {
    // Just before midnight on 31 March in UTC is already April in Oslo.
    expect(quarterOf("2026-03-31T22:30:00Z", "Europe/Oslo")).toBe(2);
    expect(quarterOf("2026-03-31T22:30:00Z", "UTC")).toBe(1);
    expect(quarterOf("2026-12-31T12:00:00Z", "Europe/Oslo")).toBe(4);
  });

  it("writes amounts as plain decimals with the currency's own decimals", () => {
    expect(decimalAmount(123450, "NOK")).toBe("1234.50");
    expect(decimalAmount(-5, "EUR")).toBe("-0.05");
    expect(decimalAmount(1500, "ISK")).toBe("1500");
  });

  it("writes CSV a spreadsheet reads safely", () => {
    expect(toCsv([["Name", "Amount"], ['Kari "K", AS', "-12.50"], ["=HYPERLINK(1)", 3], [null, "line\nbreak"]])).toBe(
      'Name,Amount\r\n"Kari ""K"", AS",-12.50\r\n\'=HYPERLINK(1),3\r\n,"line\nbreak"\r\n',
    );
  });
});
