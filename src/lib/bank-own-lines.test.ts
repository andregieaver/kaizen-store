import { describe, expect, it } from "vitest";

import { bankOwnKind, entryOfBankOwnLine } from "./bank-own-lines";
import { entryProblems } from "./ledger";

describe("the bank's own lines: its fees and its interest (B4, D488)", () => {
  it("knows a fee and interest by their words and compounds, interest in or out by the sign", () => {
    expect(bankOwnKind({ amountMinor: -6_500, text: "Kontoholdsgebyr" })).toBe("fee");
    expect(bankOwnKind({ amountMinor: -300, text: "Transaksjonsgebyr 3 stk" })).toBe("fee");
    expect(bankOwnKind({ amountMinor: -9_900, text: "Omkostninger" })).toBe("fee");
    expect(bankOwnKind({ amountMinor: -4_900, text: "Bank charges" })).toBe("fee");
    expect(bankOwnKind({ amountMinor: 6_500, text: "Tilbakeført gebyr" })).toBe("fee");
    expect(bankOwnKind({ amountMinor: 77_000, text: "Kreditrenter" })).toBe("interest_in");
    expect(bankOwnKind({ amountMinor: 12_300, text: "Renter" })).toBe("interest_in");
    expect(bankOwnKind({ amountMinor: -12_300, text: "Debetrenter" })).toBe("interest_out");
    expect(bankOwnKind({ amountMinor: -12_300, text: "Interest" })).toBe("interest_out");
  });

  it("is nothing else: a purchase, a client's payment, a line reading as both, or nothing at all", () => {
    expect(bankOwnKind({ amountMinor: -100_000, text: "Varekjøp Kontorbutikken" })).toBeNull();
    expect(bankOwnKind({ amountMinor: 150_000, text: "Faktura 1042 Acme AS" })).toBeNull();
    expect(bankOwnKind({ amountMinor: -1_000, text: "Gebyr og renter" })).toBeNull();
    expect(bankOwnKind({ amountMinor: 0, text: "Gebyr" })).toBeNull();
    // A word that only holds the letters is not one: *parentes* is no interest, *Rentetorget* a shop.
    expect(bankOwnKind({ amountMinor: -5_000, text: "Rentetorget AS" })).toBeNull();
  });

  it("makes a balanced entry in the bank's series, on the bank's day, with no VAT, posted once for its line", () => {
    const fee = entryOfBankOwnLine({ id: "l1", day: "2027-01-31", amountMinor: -6_500, text: "Kontoholdsgebyr" }, "fee");
    expect(fee).toEqual({
      series: "B",
      date: "2027-01-31",
      text: "Kontoholdsgebyr",
      source: { kind: "bank_line", id: "l1" },
      lines: [
        { account: 1920, amountMinor: -6_500, vatCode: null },
        { account: 7770, amountMinor: 6_500, vatCode: null },
      ],
    });
    expect(entryProblems(fee)).toEqual([]);
    const interest = entryOfBankOwnLine({ id: "l2", day: "2027-01-31", amountMinor: 77_000, text: "" }, "interest_in");
    expect(interest.text).toBe("Renter");
    expect(interest.lines).toEqual([
      { account: 1920, amountMinor: 77_000, vatCode: null },
      { account: 8050, amountMinor: -77_000, vatCode: null },
    ]);
  });
});
