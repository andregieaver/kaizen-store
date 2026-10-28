import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { shipmentProblemText, type ParcelLine } from "@/lib/fulfilment";

import { orderFulfilment, parcelPrecheck } from "./fulfilment";
import { col, typedRow } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * What every carrier booking from an order shares (D372): Bring, Porterbuddy and Helthjem from the order page, and *Book labels* on the Orders list (D374).
 *
 * One booking of an order at a time: the booking runs under a transaction-scoped advisory lock (`carrier-book:{order}`) taken without waiting, so a double
 * press, two tabs, or the order page and the bulk action together make one carrier shipment, and the second is told plainly that another booking is under way.
 * What the parcel holds is checked under the lock before the carrier is asked (`parcelPrecheck()`), and again by `markSent()` under the order's lock; with
 * `seen` (the order's fulfilment as the screen showed it, `OrderFulfilment.basis`) a press made before the page showed the last parcel is refused as
 * `changed` before the carrier is paid. This replaced the window of two minutes in which a second booking of the same order was refused (D134), which kept
 * two parcels of one order from being booked back to back: Bring itself identifies a booking by nothing of the order's (its request carries no order
 * reference), so it never refused them.
 */

/** What staff read when another booking of the same order holds the lock. */
export const BOOKING_BUSY = "Another booking of this order is being made right now. Wait for it to finish, then reload the page.";

/**
 * Runs `work` while this order is booked by no one else; `null` when another booking holds it. The lock is released when the work ends (its transaction
 * commits); the work writes through its own statements and transactions, as `markSent()` does.
 */
export async function oneBookingAtATime<T>(orderId: string, work: () => Promise<T>): Promise<T | null> {
  let acquired = false;
  let result: T | null = null;
  await db().transaction(async (tx) => {
    const [lock] = await tx.execute<Row>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`carrier-book:${orderId}`}, 0)) as ok`);
    acquired = lock?.ok === true;
    if (acquired) result = await work();
  });
  return acquired ? result : null;
}

/**
 * The reference of the next parcel of this order at a carrier that takes an idempotency key (`BookingRequest.parcelReference`): the order's number for
 * its first parcel, then `{number}-{n}` for the n-th (parcels undone count, so a number is never used for two parcels). Read under the booking lock, so a
 * retry of a parcel whose booking failed has the same reference and another parcel a new one. Porterbuddy took the order's number as its key, so it
 * would have answered a second parcel of an order with the first one's booking.
 */
export async function parcelReference(storeId: string, orderId: string, orderNumber: string): Promise<string> {
  const row = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.shipments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`);
  const n = (row?.n ?? 0) + 1;
  return n === 1 ? orderNumber : `${orderNumber}-${n}`;
}

/** Why this parcel cannot be booked now, or null: the screen saw another state of the order (`seen`), or what it holds does not fit (`parcelPrecheck()`). */
export async function bookingPrecheck(storeId: string, orderId: string, lines?: readonly ParcelLine[] | null, seen?: string | null): Promise<string | null> {
  if (seen) {
    const found = await orderFulfilment(db(), storeId, orderId);
    if (!found) return shipmentProblemText("not_found");
    if (found.basis !== seen) return shipmentProblemText("changed");
  }
  return parcelPrecheck(storeId, orderId, lines);
}
