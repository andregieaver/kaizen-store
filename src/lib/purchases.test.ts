import { describe, expect, it } from "vitest";

import { entryProblems, isVatCode, standardAccount } from "./ledger";
import { entryOfPurchase, INPUT_VAT, PURCHASE_KINDS, vatInside, voucherTypeOf } from "./purchases";

const line = { id: "l1", day: "2027-01-25", amountMinor: -100_000, text: "Varekjøp Kontorbutikken" };

describe("a purchase posted from the bank with its receipt (B3, D490)", () => {
  it("names a standard account for each kind, and a standard code and VAT account for each rate", () => {
    for (const { account } of Object.values(PURCHASE_KINDS)) expect(standardAccount(String(account)), String(account)).toBeTruthy();
    for (const { code, account } of Object.values(INPUT_VAT)) {
      expect(isVatCode(code)).toBe(true);
      expect(standardAccount(String(account))).toBeTruthy();
    }
  });

  it("works the VAT out of the amount in code, to the øre", () => {
    expect(vatInside(100_000, 25)).toBe(20_000);
    expect(vatInside(12_345, 25)).toBe(2_469);
    expect(vatInside(11_200, 12)).toBe(1_200);
    expect(vatInside(11_500, 15)).toBe(1_500);
    expect(vatInside(9_900, 0)).toBe(0);
  });

  it("posts the cost without VAT and the deductible VAT apart, against the bank, balanced, once for the line", () => {
    const entry = entryOfPurchase(line, { kind: "office", vatRate: 25 })!;
    expect(entry).toEqual({
      series: "B",
      date: "2027-01-25",
      text: "Varekjøp Kontorbutikken",
      source: { kind: "bank_line", id: "l1" },
      lines: [
        { account: 6800, amountMinor: 80_000, vatCode: "1" },
        { account: 2710, amountMinor: 20_000, vatCode: "1" },
        { account: 1920, amountMinor: -100_000, vatCode: null },
      ],
    });
    expect(entryProblems(entry)).toEqual([]);
    // Travel at 12 %, and the owner's own words over the bank's.
    const trip = entryOfPurchase({ ...line, amountMinor: -11_200 }, { kind: "travel", vatRate: 12, text: "Flybillett Oslo–Bergen" })!;
    expect(trip.text).toBe("Flybillett Oslo–Bergen");
    expect(trip.lines).toEqual([
      { account: 7140, amountMinor: 10_000, vatCode: "13" },
      { account: 2713, amountMinor: 1_200, vatCode: "13" },
      { account: 1920, amountMinor: -11_200, vatCode: null },
    ]);
  });

  it("takes no VAT back on entertainment whatever the receipt shows, none at no rate, and nothing for money in", () => {
    expect(entryOfPurchase(line, { kind: "meals", vatRate: 25 })!.lines).toEqual([
      { account: 7350, amountMinor: 100_000, vatCode: null },
      { account: 1920, amountMinor: -100_000, vatCode: null },
    ]);
    expect(entryOfPurchase(line, { kind: "insurance", vatRate: 0 })!.lines).toEqual([
      { account: 7500, amountMinor: 100_000, vatCode: null },
      { account: 1920, amountMinor: -100_000, vatCode: null },
    ]);
    expect(entryOfPurchase({ ...line, amountMinor: 100_000 }, { kind: "office", vatRate: 25 })).toBeNull();
  });

  it("knows a voucher's type by its first bytes, never by its name", () => {
    const bytes = (...b: (number | string)[]) => new Uint8Array(b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
    expect(voucherTypeOf(bytes("%PDF-1.7\n"))).toEqual({ contentType: "application/pdf", ext: "pdf" });
    expect(voucherTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ contentType: "image/jpeg", ext: "jpg" });
    expect(voucherTypeOf(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ contentType: "image/png", ext: "png" });
    expect(voucherTypeOf(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toEqual({ contentType: "image/webp", ext: "webp" });
    expect(voucherTypeOf(bytes(0, 0, 0, 24, "ftypheic"))).toEqual({ contentType: "image/heic", ext: "heic" });
    expect(voucherTypeOf(bytes("<html>"))).toBeNull();
    expect(voucherTypeOf(bytes("GIF89a"))).toBeNull();
  });
});
