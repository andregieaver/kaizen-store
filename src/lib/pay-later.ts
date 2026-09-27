/**
 * How appointments are paid (D66): all now, a deposit now and the rest at
 * the venue, or everything at the venue; and until when shoppers may cancel
 * or move a booking themselves. Pure, shared by the editor, the cart and
 * checkout, so they all work out the same amounts.
 */

export const PAYMENT_MODES = ["now", "deposit", "venue"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const parsePaymentMode = (value: unknown): PaymentMode =>
  PAYMENT_MODES.includes(value as PaymentMode) ? (value as PaymentMode) : "now";

export const DEFAULT_DEPOSIT_PERCENT = 30;
export const DEFAULT_CANCEL_HOURS = 24;

/** How an appointment is paid, as its product says. */
export type AppointmentPayment = { mode: PaymentMode; depositPercent: number };

/**
 * The part of a line's total (after any discount) paid at the venue: all of
 * it, or what the deposit leaves, the deposit rounded to the nearest minor
 * unit; nothing for a line paid now.
 */
export function venuePart(totalMinor: number, payment: AppointmentPayment | null): number {
  if (!payment || totalMinor <= 0) return 0;
  if (payment.mode === "venue") return totalMinor;
  if (payment.mode === "deposit") return totalMinor - Math.round((totalMinor * payment.depositPercent) / 100);
  return 0;
}

const HOUR = 60 * 60 * 1000;

/** Whether the shopper may still cancel or move a booking starting then, by the appointment's rule. */
export function selfServiceOpen(startsAt: string, cancelHours: number, now: number): boolean {
  return Date.parse(startsAt) - now >= cancelHours * HOUR;
}

/**
 * A no-show or late cancellation fee: its percentage of the line's total,
 * less the deposit already paid for it, never below nothing.
 */
export function noShowCharge(totalMinor: number, paidMinor: number, percent: number): number {
  return Math.max(0, Math.round((totalMinor * percent) / 100) - paidMinor);
}
