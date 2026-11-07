import type { LedgerEntryInput } from "./ledger";

/**
 * A purchase posted from the bank's statement with its receipt (B3 of `docs/own-books-and-sales.md`, D490). Pure: what the purchase was, in
 * the plain words the owner chooses from, the cost account each is (Norway's standard accounts) and the VAT rate it most often carries, and
 * the entry it makes: the cost without VAT and the deductible VAT apart (worked out in code from the bank's amount), against the bank.
 * Entertainment is the one kind whose VAT is never deductible, whatever rate the receipt shows.
 */

export const PURCHASE_KINDS = {
  goods: { account: 4300, vat: 25 },
  office: { account: 6800, vat: 25 },
  software: { account: 6553, vat: 25 },
  equipment: { account: 6551, vat: 25 },
  phone: { account: 6900, vat: 25 },
  advertising: { account: 7320, vat: 25 },
  courses: { account: 6860, vat: 25 },
  accounting: { account: 6705, vat: 25 },
  travel: { account: 7140, vat: 12 },
  meals: { account: 7350, vat: 0 },
  rent: { account: 6300, vat: 0 },
  postage: { account: 6940, vat: 0 },
  insurance: { account: 7500, vat: 0 },
} as const satisfies Record<string, { account: number; vat: PurchaseVatRate }>;

export type PurchaseKind = keyof typeof PURCHASE_KINDS;

export const PURCHASE_VAT_RATES = [25, 15, 12, 0] as const;
export type PurchaseVatRate = (typeof PURCHASE_VAT_RATES)[number];

/** The kinds whose VAT may never be deducted (entertainment, Norway's VAT act § 8-3). */
const NO_VAT_BACK: ReadonlySet<PurchaseKind> = new Set(["meals"]);

/** Deductible domestic input VAT by rate: SAF-T's code and the account it is posted to. */
export const INPUT_VAT: Record<Exclude<PurchaseVatRate, 0>, { code: string; account: number }> = {
  25: { code: "1", account: 2710 },
  15: { code: "11", account: 2711 },
  12: { code: "13", account: 2713 },
};

/** The bank's account a purchase is paid from. */
const BANK = 1920;

export const isPurchaseKind = (value: unknown): value is PurchaseKind => typeof value === "string" && Object.hasOwn(PURCHASE_KINDS, value);
export const isPurchaseVatRate = (value: unknown): value is PurchaseVatRate => PURCHASE_VAT_RATES.includes(Number(value) as PurchaseVatRate);

/** The VAT inside an amount with VAT at a rate, to the øre (half away from zero). */
export function vatInside(grossMinor: number, rate: PurchaseVatRate): number {
  if (rate === 0) return 0;
  const vat = Math.round((Math.abs(grossMinor) * rate) / (100 + rate));
  return grossMinor < 0 ? -vat : vat;
}

/** The rate that counts: none for a kind whose VAT is never deducted. */
export const vatRateOf = (kind: PurchaseKind, rate: PurchaseVatRate): PurchaseVatRate => (NO_VAT_BACK.has(kind) ? 0 : rate);

/**
 * The entry of a purchase paid from the bank (money out, a negative amount): its cost account without VAT and the deductible VAT on its
 * account, both with the VAT code, against the bank, in the bank's series on the bank's day, posted once for the line. Null for money in.
 */
/** A purchase's cost lines for an amount with VAT: the cost without VAT and the deductible VAT apart, both with the VAT code (debits). */
export function costLinesOf(grossMinor: number, kind: PurchaseKind, vatRate: PurchaseVatRate): LedgerEntryInput["lines"] {
  const rate = vatRateOf(kind, vatRate);
  const vat = vatInside(grossMinor, rate);
  const cost = PURCHASE_KINDS[kind].account;
  return rate === 0
    ? [{ account: cost, amountMinor: grossMinor, vatCode: null }]
    : [
        { account: cost, amountMinor: grossMinor - vat, vatCode: INPUT_VAT[rate].code },
        { account: INPUT_VAT[rate].account, amountMinor: vat, vatCode: INPUT_VAT[rate].code },
      ];
}

export function entryOfPurchase(
  line: { id: string; day: string; amountMinor: number; text: string },
  input: { kind: PurchaseKind; vatRate: PurchaseVatRate; text?: string | null },
): LedgerEntryInput | null {
  if (line.amountMinor >= 0) return null;
  const paid = -line.amountMinor;
  const text = (input.text?.trim() || line.text.trim() || "Kjøp").slice(0, 200);
  return {
    series: "B",
    date: line.day,
    text,
    source: { kind: "bank_line", id: line.id },
    lines: [...costLinesOf(paid, input.kind, input.vatRate), { account: BANK, amountMinor: -paid, vatCode: null }],
  };
}

/** The pictures of receipts the model reads (D491; a PDF or a HEIC photo is not read: the owner chooses, as before). */
export const READABLE_RECEIPTS = ["image/jpeg", "image/png", "image/webp"] as const;

/** The file types a voucher may be, by their first bytes (never by the name or the browser's word): its MIME type and extension. */
export function voucherTypeOf(bytes: Uint8Array): { contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic"; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 5 && ascii(0, 5) === "%PDF-") return { contentType: "application/pdf", ext: "pdf" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return { contentType: "image/png", ext: "png" };
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1"].includes(ascii(8, 12))) return { contentType: "image/heic", ext: "heic" };
  return null;
}
