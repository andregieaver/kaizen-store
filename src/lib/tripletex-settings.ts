import { z } from "zod";

/**
 * Tripletex (D453): what a connection books where. Every amount Kaizena Flow sends falls in one bucket (`BookingKey`), and each
 * bucket is booked on one income account with one VAT code. The setup picks them from the company's own chart
 * (`planSetup()`, `src/lib/tripletex-setup.ts`); Customise lets an owner or the accountant change any. Accounts and VAT codes
 * are kept by their numbers, as people read them, and resolved to Tripletex's ids at every run. No secrets here: this is
 * shared with the browser.
 */

/**
 * The buckets. Norwegian VAT for sales [docs: Tripletex's code list]:
 * - `standard_25`, `standard_15`, `standard_12`: output VAT at the high, middle and low rate (codes 3, 31 and 33).
 * - `standard_0`: no VAT charged by a seller that is not VAT registered.
 * - `exempt`: sales exempt from VAT within the VAT act (code 5).
 * - `outside_scope`: outside the VAT act (code 6).
 * - `reverse_charge`: services to a business abroad, VAT due by the buyer (code 6 by default; the accountant may choose 52).
 * - `gift_card`: a gift card sold is a debt to its holder until spent, not income (no VAT code).
 */
export const BOOKING_KEYS = ["standard_25", "standard_15", "standard_12", "standard_0", "exempt", "outside_scope", "reverse_charge", "gift_card"] as const;

export type BookingKey = (typeof BOOKING_KEYS)[number];

export const isBookingKey = (value: string): value is BookingKey => (BOOKING_KEYS as readonly string[]).includes(value);

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

/** The bucket of a VAT rate charged at the standard basis (a fraction such as 0.25 or the text `0.2500`), or null for a rate Norway does not have. */
export function standardKeyOf(rate: number | string): BookingKey | null {
  const bp = Math.round(Number(rate) * 10000);
  if (bp === 2500) return "standard_25";
  if (bp === 1500) return "standard_15";
  if (bp === 1200) return "standard_12";
  if (bp === 0) return "standard_0";
  return null;
}

/** How a person reads each bucket, in the settings and in the summary for the accountant. */
export const BOOKING_WORDS: Record<BookingKey, { en: string; nb: string }> = {
  standard_25: { en: "Sales with 25% VAT", nb: "Salg med 25 % mva" },
  standard_15: { en: "Sales with 15% VAT (food)", nb: "Salg med 15 % mva (mat)" },
  standard_12: { en: "Sales with 12% VAT", nb: "Salg med 12 % mva" },
  standard_0: { en: "Sales without VAT (not VAT registered)", nb: "Salg uten mva (ikke mva-registrert)" },
  exempt: { en: "Sales exempt from VAT", nb: "Salg fritatt for mva" },
  outside_scope: { en: "Sales outside the VAT act", nb: "Salg utenfor mva-loven" },
  reverse_charge: { en: "Services to businesses abroad", nb: "Tjenester til næringsdrivende i utlandet" },
  gift_card: { en: "Gift cards sold (owed to their holders)", nb: "Solgte gavekort (gjeld til innehaver)" },
};
