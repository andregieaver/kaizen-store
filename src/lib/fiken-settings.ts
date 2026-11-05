import { z } from "zod";

import { BOOKING_KEYS, type BookingKey } from "./accounting-docs";

/**
 * Fiken (D460): what a connection books where. Every amount falls in one bucket (`BookingKey`, shared with Tripletex), and each bucket is a
 * sale line on one income account with one of Fiken's VAT types for sales. The setup picks the accounts from the company's own chart
 * (`planFikenSetup()`); Customise lets an owner or the accountant change any. What the customers owe is Fiken's own customer ledger
 * (1500 and the customer's number), so there is no receivable to choose. No secrets here: shared with the browser.
 */

/** Fiken's VAT types for sales [spec: orderLine.vatType], with the codes the accountant knows them by (Sticos mvakoder). */
export const FIKEN_SALE_VAT_TYPES = ["HIGH", "MEDIUM", "LOW", "RAW_FISH", "NONE", "EXEMPT", "EXEMPT_IMPORT_EXPORT", "OUTSIDE", "EXEMPT_REVERSE"] as const;

export type FikenVatType = (typeof FIKEN_SALE_VAT_TYPES)[number];

export const VAT_TYPE_CODES: Record<FikenVatType, string> = {
  HIGH: "3",
  MEDIUM: "31",
  LOW: "33",
  RAW_FISH: "32",
  NONE: "7",
  EXEMPT: "5",
  EXEMPT_IMPORT_EXPORT: "52",
  OUTSIDE: "6",
  EXEMPT_REVERSE: "51",
};

/** Where each bucket goes by default: Fiken's standard chart (3000 taxable sales, 3100 exempt, 3200 outside the VAT area, 2900 other short-term debt). */
export const DEFAULT_FIKEN_BOOKING: Record<BookingKey, { account: string; vatType: FikenVatType }> = {
  standard_25: { account: "3000", vatType: "HIGH" },
  standard_15: { account: "3000", vatType: "MEDIUM" },
  standard_12: { account: "3000", vatType: "LOW" },
  standard_0: { account: "3000", vatType: "NONE" },
  exempt: { account: "3100", vatType: "EXEMPT" },
  outside_scope: { account: "3200", vatType: "OUTSIDE" },
  reverse_charge: { account: "3200", vatType: "OUTSIDE" },
  gift_card: { account: "2900", vatType: "NONE" },
};

const accountCode = z.string().trim().regex(/^\d{4}$/);

export const fikenBookingSchema = z.object({ account: accountCode, vatType: z.enum(FIKEN_SALE_VAT_TYPES) });

export type FikenBooking = z.infer<typeof fikenBookingSchema>;

export const fikenSettingsSchema = z.object({
  version: z.literal(1),
  /** What is sent: Work's invoices and credit notes, the shop's, or both. */
  sources: z.object({ work: z.boolean(), shop: z.boolean() }),
  /** Only the buckets this store needs; a document with a bucket not here waits for a person (`vat_unmapped`). */
  bookings: z.partialRecord(z.enum(BOOKING_KEYS), fikenBookingSchema),
  /** The language of the texts on sales and of the shop's customer. */
  language: z.enum(["nb", "en"]),
  /** Work clients' email address on their contact in Fiken (off: name, number and address only). */
  sendContactEmail: z.boolean(),
  /** Attach each document's PDF to its sale, where one exists. */
  attachPdf: z.boolean(),
});

export type FikenSettings = z.infer<typeof fikenSettingsSchema>;

export function defaultFikenSettings(keys: readonly BookingKey[], sources: FikenSettings["sources"]): FikenSettings {
  return {
    version: 1,
    sources,
    bookings: Object.fromEntries(keys.map((key) => [key, { ...DEFAULT_FIKEN_BOOKING[key] }])),
    language: "nb",
    sendContactEmail: false,
    attachPdf: true,
  };
}

/** Kept settings, read back; `null` when they no longer fit the schema (the page then offers the setup again). */
export function readFikenSettings(value: unknown): FikenSettings | null {
  const parsed = fikenSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const isFikenVatType = (value: string): value is FikenVatType => (FIKEN_SALE_VAT_TYPES as readonly string[]).includes(value);
