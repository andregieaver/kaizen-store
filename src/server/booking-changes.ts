import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db/client";
import { bookingSpan } from "@/lib/booking-slots";
import { selfServiceOpen } from "@/lib/pay-later";

import { freeResourcesAt } from "./appointments";
import { ownsOrder } from "./customers";
import { getOrderAdmin, refundOrder } from "./order-admin";
import { getOrder, type OrderBooking, type OrderView } from "./orders";
import { sendBookingCancelledByShopper, sendBookingMoved, sendBookingStaffChange } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Shoppers change their own bookings (D66): cancel or move one until the
 * appointment's hours before it, from the order page (opened by its key) or
 * from My account (signed in). Cancelling pays back what was paid online
 * for it; moving takes a time the product page would offer, with the same
 * member of staff if they are free.
 */

/** How the shopper shows the order is theirs: the order page's key, or their signed-in account. */
export type ShopperAccess = { sessionId: string } | { customerId: string };

export type ChangeOutcome = "done" | "closed" | "taken" | "not_found";

async function canAccess(storeId: string, orderId: string, access: ShopperAccess): Promise<boolean> {
  if ("customerId" in access) return ownsOrder(storeId, access.customerId, orderId);
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.payments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
      and provider in ('stripe', 'venue') and provider_reference = ${access.sessionId}
  `);
  return Boolean(row);
}

type Found = { order: OrderView; line: OrderView["lines"][number]; booking: OrderBooking };

/** The shopper's confirmed booking on a paid order, or null. */
async function ownBooking(storeId: string, orderId: string, access: ShopperAccess, bookingId: string): Promise<Found | null> {
  if (!(await canAccess(storeId, orderId, access))) return null;
  const order = await getOrder(storeId, orderId);
  if (!order || (order.status !== "paid" && order.status !== "fulfilled")) return null;
  const line = order.lines.find((l) => l.booking?.id === bookingId);
  if (!line?.booking || line.booking.status !== "confirmed") return null;
  return { order, line, booking: line.booking };
}

/** Sends after the response where there is one; at once in scripts and tests. */
async function later(work: () => Promise<unknown>): Promise<void> {
  try {
    after(work);
  } catch {
    await work();
  }
}

async function event(storeId: string, orderId: string, type: string, data: Record<string, unknown>) {
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, 'shopper')
  `);
}

/**
 * Cancels the shopper's booking while the rule allows: its time is free
 * again, what was paid online for it is paid back, nothing is left to pay
 * for it at the venue, and an order of nothing but cancelled bookings is
 * cancelled.
 */
export async function cancelOwnBooking(
  storeId: string,
  orderId: string,
  access: ShopperAccess,
  bookingId: string,
  now = Date.now(),
): Promise<{ outcome: ChangeOutcome; refundMinor: number }> {
  const found = await ownBooking(storeId, orderId, access, bookingId);
  if (!found) return { outcome: "not_found", refundMinor: 0 };
  const { line, booking } = found;
  if (!selfServiceOpen(booking.startsAt, booking.cancelHours, now)) return { outcome: "closed", refundMinor: 0 };

  const [cancelled] = await db().execute<Row>(sql`
    update commerce.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where store_id = ${storeId}::uuid and id = ${bookingId}::uuid and status = 'confirmed'
    returning id
  `);
  if (!cancelled) return { outcome: "not_found", refundMinor: 0 };
  await db().execute(sql`
    update commerce.orders set balance_minor = greatest(0, balance_minor - ${line.venueMinor})
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);

  // What was paid online for it: the whole line, or its deposit.
  const admin = await getOrderAdmin(storeId, orderId);
  const refund = Math.min(line.totalMinor - line.venueMinor, admin?.refundableMinor ?? 0);
  let refunded = 0;
  if (refund > 0 && admin?.canRefund) {
    const result = await refundOrder(storeId, orderId, { amountMinor: refund, reason: "Cancelled by the customer", restock: [] }, null);
    if (result.ok) refunded = refund;
  }
  await event(storeId, orderId, "booking.cancelled_by_customer", { booking: bookingId, refunded, due: refund });

  // Nothing left on the order: it is cancelled as a whole.
  const [left] = await db().execute<Row>(sql`
    select exists (
      select 1 from commerce.order_lines ol
      where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid
        and not exists (
          select 1 from commerce.bookings b
          where b.store_id = ol.store_id and b.order_line_id = ol.id and b.status = 'cancelled'
        )
    ) as any
  `);
  if (!left?.any) {
    await db().execute(sql`
      update commerce.orders set status = 'cancelled', balance_minor = 0
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid and status in ('paid', 'fulfilled')
    `);
  }
  await later(async () => {
    await sendBookingCancelledByShopper(storeId, bookingId, refunded);
    await sendBookingStaffChange(storeId, bookingId, "cancelled");
  });
  return { outcome: "done", refundMinor: refunded };
}

/**
 * Moves the shopper's booking to another time the rule and the calendar
 * allow: with the same member of staff if they are free then, else the
 * first who is. The change is checked again under a lock.
 */
export async function moveOwnBooking(
  storeId: string,
  orderId: string,
  access: ShopperAccess,
  bookingId: string,
  startsAt: string,
  now = Date.now(),
): Promise<ChangeOutcome> {
  const found = await ownBooking(storeId, orderId, access, bookingId);
  if (!found) return "not_found";
  const { booking } = found;
  if (!selfServiceOpen(booking.startsAt, booking.cancelHours, now)) return "closed";
  if (Date.parse(startsAt) === Date.parse(booking.startsAt)) return "done";

  const free = await freeResourcesAt(db(), storeId, booking.productId, startsAt, null, now, bookingId);
  if (!free || free.resourceIds.length === 0) return "taken";
  const candidates = [
    ...free.resourceIds.filter((id) => id === booking.resourceId),
    ...free.resourceIds.filter((id) => id !== booking.resourceId),
  ];
  const span = bookingSpan(Date.parse(startsAt), free.offer.rules);
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const resourceId of candidates) {
    const [row] = await db().execute<Row>(sql`
      select commerce.move_booking(
        ${storeId}::uuid, ${bookingId}::uuid, ${resourceId}::uuid,
        ${iso(span.startsAt)}::timestamptz, ${iso(span.endsAt)}::timestamptz,
        ${iso(span.blockedFrom)}::timestamptz, ${iso(span.blockedTo)}::timestamptz
      ) as moved
    `);
    if (row?.moved) {
      await event(storeId, orderId, "booking.moved", { booking: bookingId, from: booking.startsAt, to: iso(span.startsAt) });
      await later(async () => {
        await sendBookingMoved(storeId, bookingId);
        await sendBookingStaffChange(storeId, bookingId, "moved");
      });
      return "done";
    }
  }
  return "taken";
}
