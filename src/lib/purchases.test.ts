import { describe, expect, it } from "vitest";

import { entryProblems, isVatCode, standardAccount, vatByCode } from "./ledger";
import { boughtAbroad, entryOfPurchase, INPUT_VAT, PURCHASE_KINDS, purchaseAccounts, REVERSE_CHARGE, vatInside, voucherTypeOf } from "./purchases";
import { entryOfBill } from "./supplier-invoices";
import { vatReturnOf } from "./vat-return";

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

describe("a service bought from abroad, its VAT reckoned by the store (D502)", () => {
  const claude = { id: "l2", day: "2026-03-04", amountMinor: -21_437, text: "ANTHROPIC CLAUDE.AI SUBSCRIPTION" };

  it("names standard codes and accounts", () => {
    expect(isVatCode(REVERSE_CHARGE.deductible)).toBe(true);
    expect(isVatCode(REVERSE_CHARGE.notDeductible)).toBe(true);
    expect(standardAccount(String(REVERSE_CHARGE.due))).toBeTruthy();
    expect(standardAccount(String(REVERSE_CHARGE.deducted))).toBeTruthy();
  });

  it("posts all of what was paid as cost, and 25 % of it as VAT due and deducted on code 86, netting to nought", () => {
    const entry = entryOfPurchase(claude, { kind: "software", vatRate: 25, abroad: true })!;
    expect(entry.lines).toEqual([
      { account: 6553, amountMinor: 21_437, vatCode: "86" },
      { account: 2714, amountMinor: 5_359, vatCode: "86" },
      { account: 2704, amountMinor: -5_359, vatCode: "86" },
      { account: 1920, amountMinor: -21_437, vatCode: null },
    ]);
    expect(entryProblems(entry)).toEqual([]);
    // The VAT chosen on the form does not matter: the store reckons it at 25 %.
    expect(entryOfPurchase(claude, { kind: "software", vatRate: 0, abroad: true })!.lines).toEqual(entry.lines);
    expect(purchaseAccounts("software", 0, true)).toEqual([6553, 2704, 2714]);
    expect(purchaseAccounts("software", 25)).toEqual([6553, 2710]);
    expect(purchaseAccounts("insurance", 0)).toEqual([7500]);
  });

  it("owes the VAT on entertainment from abroad and keeps it as a cost (code 87)", () => {
    const entry = entryOfPurchase({ ...claude, amountMinor: -40_000 }, { kind: "meals", vatRate: 0, abroad: true })!;
    expect(entry.lines).toEqual([
      { account: 7350, amountMinor: 40_000, vatCode: "87" },
      { account: 7350, amountMinor: 10_000, vatCode: null },
      { account: 2704, amountMinor: -10_000, vatCode: "87" },
      { account: 1920, amountMinor: -40_000, vatCode: null },
    ]);
    expect(entryProblems(entry)).toEqual([]);
    expect(purchaseAccounts("meals", 25, true)).toEqual([7350, 2704]);
  });

  it("does the same for a bill, against what the store owes", () => {
    const entry = entryOfBill({ id: "b1", day: "2026-03-01", totalMinor: 250_000, kind: "software", vatRate: 25, abroad: true, text: "Vercel Inc., faktura 123" });
    expect(entry.lines).toEqual([
      { account: 6553, amountMinor: 250_000, vatCode: "86" },
      { account: 2714, amountMinor: 62_500, vatCode: "86" },
      { account: 2704, amountMinor: -62_500, vatCode: "86" },
      { account: 2400, amountMinor: -250_000, vatCode: null },
    ]);
  });

  it("stands on the VAT return as a base with VAT due and the same deducted, and on code 87 as VAT due alone", () => {
    const lines = [
      ...entryOfPurchase(claude, { kind: "software", vatRate: 25, abroad: true })!.lines,
      ...entryOfBill({ id: "b1", day: "2026-03-01", totalMinor: 250_000, kind: "software", vatRate: 25, abroad: true, text: "Vercel" }).lines,
      ...entryOfPurchase({ ...claude, amountMinor: -40_000 }, { kind: "meals", vatRate: 0, abroad: true })!.lines,
    ];
    const rows = vatByCode(lines.filter((l) => l.vatCode).map((l) => ({ account: l.account, vatCode: l.vatCode!, amountMinor: l.amountMinor })));
    expect(rows).toEqual([
      { code: "86", base: -271_437, vat: 0 },
      { code: "87", base: -40_000, vat: 10_000 },
    ]);
    const vatReturn = vatReturnOf(rows);
    expect(vatReturn.lines).toEqual([
      { code: "86", side: "due", base: 271_437, rate: 25, vat: 67_859 },
      { code: "86", side: "deducted", base: null, rate: null, vat: -67_859 },
      { code: "87", side: "due", base: 40_000, rate: 25, vat: 10_000 },
    ]);
    expect(vatReturn.total).toBe(10_000);
  });

  it("guesses abroad for a reading in another currency than the books' with no VAT on it", () => {
    expect(boughtAbroad({ currency: "USD", vatRate: 0 }, "NOK")).toBe(true);
    expect(boughtAbroad({ currency: "EUR", vatRate: null }, "NOK")).toBe(true);
    expect(boughtAbroad({ currency: "USD", vatRate: 25 }, "NOK")).toBe(false);
    expect(boughtAbroad({ currency: "NOK", vatRate: 0 }, "NOK")).toBe(false);
    expect(boughtAbroad({ currency: null, vatRate: 0 }, "NOK")).toBe(false);
  });
});
