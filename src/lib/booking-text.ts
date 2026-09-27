/**
 * A booking in words (D65, D67): an appointment's time and who with, or a
 * stay's check-in and check-out (a rental's pick-up and return) and which
 * room or item, in the store's time zone.
 */
import { formatBookingTime } from "./booking-slots";
import type { Messages } from "./i18n";

export type ShownBooking = {
  kind: "appointment" | "stay" | "rental";
  startsAt: string;
  /** Check-out or return; an appointment's end is not shown. */
  endsAt: string | null;
  /** Who, or which room or item; null when whichever is free. */
  staff: string | null;
  timeZone: string;
};

export function bookingWhen(booking: ShownBooking, locale: string, m: Messages): string {
  const from = formatBookingTime(booking.startsAt, locale, booking.timeZone);
  if (booking.kind === "appointment" || !booking.endsAt) {
    return booking.staff ? `${from}, ${m.booking.withStaff(booking.staff)}` : from;
  }
  const to = formatBookingTime(booking.endsAt, locale, booking.timeZone);
  const text = booking.kind === "stay" ? m.stay.stay(from, to) : m.stay.rental(from, to);
  return booking.staff ? `${text} · ${booking.staff}` : text;
}

/** Whether a booking is by the night or the day (D67), not a time. */
export const isRange = (booking: { kind: ShownBooking["kind"] } | null | undefined): boolean =>
  booking?.kind === "stay" || booking?.kind === "rental";
