import { z } from "zod";

import { BOOKING_KEYS, type BookingKey } from "./accounting-docs";

export { BOOKING_KEYS, BOOKING_WORDS, isBookingKey, standardKeyOf, type BookingKey } from "./accounting-docs";

/**
 * Tripletex (D453): what a connection books where. Every amount Kaizena Flow sends falls in one bucket (`BookingKey`), and each
 * bucket is booked on one income account with one VAT code. The setup picks them from the company's own chart
 * (`planSetup()`, `src/lib/tripletex-setup.ts`); Customise lets an owner or the accountant change any. Accounts and VAT codes
 * are kept by their numbers, as people read them, and resolved to Tripletex's ids at every run. No secrets here: this is
 * shared with the browser.
 */

/** Where each bucket goes by default: Norway's standard chart of accounts (NS 4102), as Tripletex sets a new company up. */
export const DEFAULT_BOOKING: Record<BookingKey, { account: number; vatCode: string }> = {
  standard_25: { account: 3000, vatCode: "3" },
  standard_15: { account: 3000, vatCode: "31" },
  standard_12: { account: 3000, vatCode: "33" },
  standard_0: { account: 3000, vatCode: "0" },
  exempt: { account: 3100, vatCode: "5" },
  outside_scope: { account: 3200, vatCode: "6" },
  reverse_charge: { account: 3200, vatCode: "6" },
  gift_card: { account: 2900, vatCode: "0" },
};

/** The receivable account (customer ledger) by default. */
export const DEFAULT_RECEIVABLE = 1500;

const accountNumber = z.number().int().min(1000).max(99999);
const vatCode = z.string().trim().regex(/^\d{1,3}$/);

export const bookingSchema = z.object({ account: accountNumber, vatCode });

export type Booking = z.infer<typeof bookingSchema>;

export const tripletexSettingsSchema = z.object({
  version: z.literal(1),
  /** What is sent: Work's invoices and credit notes, the shop's, or both. */
  sources: z.object({ work: z.boolean(), shop: z.boolean() }),
  receivableAccount: accountNumber,
  /** Only the buckets this store needs; a document with a bucket not here waits for a person (`vat_unmapped`). */
  bookings: z.partialRecord(z.enum(BOOKING_KEYS), bookingSchema),
  /** A Tripletex voucher type's id, or null for the company's default. */
  voucherTypeId: z.number().int().positive().nullable(),
  /** The language of the texts on vouchers and the shop's customer. */
  language: z.enum(["nb", "en"]),
  /** Work clients' email address on their customer card in Tripletex (off: name, number and address only). */
  sendContactEmail: z.boolean(),
  /** Attach each document's PDF to its voucher, where one exists. */
  attachPdf: z.boolean(),
});

export type TripletexSettings = z.infer<typeof tripletexSettingsSchema>;

export function defaultSettings(keys: readonly BookingKey[], sources: TripletexSettings["sources"]): TripletexSettings {
  return {
    version: 1,
    sources,
    receivableAccount: DEFAULT_RECEIVABLE,
    bookings: Object.fromEntries(keys.map((key) => [key, { ...DEFAULT_BOOKING[key] }])),
    voucherTypeId: null,
    language: "nb",
    sendContactEmail: false,
    attachPdf: true,
  };
}

/** Kept settings, read back; `null` when they no longer fit the schema (the page then offers the setup again). */
export function readSettings(value: unknown): TripletexSettings | null {
  const parsed = tripletexSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
