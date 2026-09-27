import { bookingChangesLabels } from "@/lib/booking-labels";
import { formatBookingTime } from "@/lib/booking-slots";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { selfServiceOpen } from "@/lib/pay-later";
import type { OrderView } from "@/server/orders";

import { BookingChanges } from "./booking-changes";

const HOUR = 60 * 60 * 1000;
/** Now, for whether a booking can still be changed: the page is rendered per request. */
const nowMs = () => Date.now();

/**
 * The appointments on a paid order, each with a way to change or cancel it
 * while its rule allows (D66): on the order page and in My account.
 */
export function OwnBookings({
  order,
  store,
  market,
  m,
  sessionId,
}: {
  order: OrderView;
  store: string;
  market: Market;
  m: Messages;
  /** The order page's key; null in My account. */
  sessionId: string | null;
}) {
  if (order.status !== "paid" && order.status !== "fulfilled") return null;
  const booked = order.lines.filter((line) => line.booking?.status === "confirmed");
  if (booked.length === 0) return null;
  const now = nowMs();
  return (
    <section aria-labelledby="own-bookings" className="rounded-lg border border-border p-4">
      <h2 id="own-bookings" className="mb-3 font-medium">
        {m.booking.time}
      </h2>
      <ul className="flex flex-col gap-4">
        {booked.map((line) => {
          const booking = line.booking!;
          const until = new Date(Date.parse(booking.startsAt) - booking.cancelHours * HOUR).toISOString();
          const paidOnline = line.totalMinor - line.venueMinor;
          return (
            <li key={booking.id} className="flex flex-col gap-2">
              <p>
                <span className="font-medium">{line.title}</span>
                <span className="block">
                  {formatBookingTime(booking.startsAt, market.locale, booking.timeZone)}, {m.booking.withStaff(booking.staff)}
                </span>
                {booking.place && <span className="block text-sm text-muted">{booking.place}</span>}
              </p>
              <BookingChanges
                store={store}
                market={market.slug}
                orderId={order.id}
                sessionId={sessionId}
                bookingId={booking.id}
                productId={booking.productId}
                open={selfServiceOpen(booking.startsAt, booking.cancelHours, now)}
                labels={bookingChangesLabels(
                  m,
                  formatBookingTime(until, market.locale, booking.timeZone),
                  paidOnline > 0 ? formatMoney(paidOnline, order.currency, market.locale) : null,
                )}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
