import { z } from "zod";

import { zonedDate } from "./booking-slots";

/**
 * DAC7 (Council Directive (EU) 2021/514, D71): a platform that lets people
 * rent out property, offer services or rent out means of transport reports
 * each seller's identity and what they earned, per quarter, once a year by
 * 31 January. A store with hosts is that platform; Kaizen collects the
 * hosts' details and prepares the report for the store to file. Pure, so
 * the rules are tested without a database.
 */

export type TaxDetails = {
  kind: "individual" | "entity";
  legalName: string;
  /** YYYY-MM-DD, for a person. */
  dateOfBirth: string | null;
  address: string;
  country: string;
  tin: string;
  tinCountry: string;
  vatNumber: string;
  businessNumber: string;
  iban: string;
};

const country = (message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, message);

/** Whether an IBAN's check digits add up (ISO 13616, mod 97). */
export function ibanValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let rest = 0;
  for (const ch of moved) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** A host's details as they type them in their area. */
export const taxDetailsInput = z
  .object({
    kind: z.enum(["individual", "entity"]),
    legalName: z.string().trim().min(1, "Write your full name, or your business's legal name.").max(200),
    dateOfBirth: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.iso.date("Give your date of birth.").nullable()),
    address: z.string().trim().min(5, "Write your address: street, postcode and town.").max(400),
    country: country("Choose the country you live in, or where your business is."),
    tin: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, ""))
      .pipe(z.string().min(3, "Write your tax identification number.").max(40)),
    tinCountry: country("Choose the country that gave the tax identification number."),
    vatNumber: z.string().trim().max(40).default(""),
    businessNumber: z.string().trim().max(40).default(""),
    iban: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .refine((v) => v === "" || ibanValid(v), "The IBAN is not right. Check it against your bank's."),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "individual" && !value.dateOfBirth) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Give your date of birth." });
    }
    if (value.kind === "entity" && !value.businessNumber) {
      ctx.addIssue({ code: "custom", path: ["businessNumber"], message: "Write your business's registration number." });
    }
  });

/** The quarter (1 to 4) a moment falls in, where the store is. */
export function quarterOf(at: string | number, timeZone: string): 1 | 2 | 3 | 4 {
  const month = Number(zonedDate(typeof at === "string" ? Date.parse(at) : at, timeZone).slice(5, 7));
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** An amount in minor units as a plain decimal (1234.50), with the currency's own number of decimals. */
export function decimalAmount(minor: number, currency: string): string {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (digits === 0) return `${sign}${abs}`;
  const unit = 10 ** digits;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/**
 * Rows as CSV (RFC 4180), for spreadsheets: fields with commas, quotes or
 * line breaks are quoted, and text a spreadsheet would read as a formula is
 * made plain text. Numbers, and amounts such as -12.50, are written as they are.
 */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    const text = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
