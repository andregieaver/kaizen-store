import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { OrderDelivery } from "@/lib/delivery-options";
import { pickupWindows } from "@/lib/porterbuddy";
import type { ShippingAddress } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { parcelInput, toParty, type ParcelInput } from "./bring-shipping";
import { adapterFor } from "./carriers";
import { senderOf } from "./carriers/porterbuddy";
import type { ParcelLine } from "@/lib/fulfilment";

import { BOOKING_BUSY, bookingPrecheck, oneBookingAtATime, parcelReference } from "./carrier-booking";
import { markSent, sendRefusalText, type Shipment } from "./order-admin";
import { getOrder } from "./orders";
import { carrierContext } from "./shipping-carriers";

type Row = Record<string, unknown>;

export type PorterbuddyBooked =
  | { ok: true; test: true; trackingNumber: string }
  | { ok: true; test: false; shipment: Shipment }
  | { ok: false; problem: string };

/**
 * Books the delivery window the shopper chose at checkout with Porterbuddy (D137). Porterbuddy holds a window only for a
 * short time, so the window is asked for again just before the order is placed and booked with the fresh token; if
 * Porterbuddy no longer offers it, nothing is booked and the owner is told to ask the customer for another time. A real
 * booking marks the order as sent with its order number as the tracking number and keeps where its label is; a test booking
 * (the store's test environment) only says it worked. One booking of an order runs at a time, and a press made before the page
 * showed the last parcel (`seen`) is refused before Porterbuddy is paid (D372, `carrier-booking.ts`).
 */
export async function porterbuddyBook(
  accountId: string,
  storeId: string,
  orderId: string,
  input: {
    parcel: unknown;
    /** What goes in this parcel (D174); none = everything still to send. */
    lines?: readonly ParcelLine[] | null;
    /** The order's fulfilment as the screen showed it (`OrderFulfilment.basis`); none from a caller that showed nothing (the bulk action). */
    seen?: string | null;
  },
): Promise<PorterbuddyBooked> {
  const parcel = parcelInput.safeParse(input.parcel);
  if (!parcel.success) return { ok: false, problem: parcel.error.issues[0].message };
  const [order, context] = await Promise.all([getOrder(storeId, orderId), carrierContext(storeId, "porterbuddy")]);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (!context) return { ok: false, problem: "Porterbuddy is not set up: save your details first." };
  if (order.copied) return { ok: false, problem: "A copied order is history and is never shipped." };
  if (!["paid", "fulfilled"].includes(order.status)) return { ok: false, problem: "Only paid orders can be shipped." };
  const chosen = order.delivery;
  if (!chosen || chosen.carrier !== "porterbuddy" || !chosen.window) return { ok: false, problem: "The customer did not choose a Porterbuddy delivery." };
  const to = toParty(order.shippingAddress, order.email);
  if (!to) return { ok: false, problem: "The order's delivery address is not complete: it needs a name, street, postal code, city and country." };
  if (to.country !== "NO") return { ok: false, problem: "Porterbuddy delivers to Norway." };
  if (!to.phone) to.phone = order.billingAddress.phone ?? "";
  const facts = { number: order.number, chosen: chosen as OrderDelivery & { window: { start: string; end: string } }, to, context };
  const booked = await oneBookingAtATime(orderId, () => bookUnderLock(accountId, storeId, orderId, facts, { ...input, parcel: parcel.data }));
  return booked ?? { ok: false, problem: BOOKING_BUSY };
}

async function bookUnderLock(
  accountId: string,
  storeId: string,
  orderId: string,
  { number, chosen, to, context }: { number: string; chosen: OrderDelivery & { window: { start: string; end: string } }; to: ShippingAddress; context: NonNullable<Awaited<ReturnType<typeof carrierContext>>> },
  input: { parcel: ParcelInput; lines?: readonly ParcelLine[] | null; seen?: string | null },
): Promise<PorterbuddyBooked> {
  // What goes in the parcel is checked before the carrier is paid for it (D174); `markSent()` checks it again under the order's lock.
  const unfit = await bookingPrecheck(storeId, orderId, input.lines, input.seen);
  if (unfit) return { ok: false, problem: unfit };

  const adapter = adapterFor("porterbuddy");
  if (!adapter?.rates || !adapter.book) return { ok: false, problem: "Porterbuddy is not available." };
  const [store] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  const from = senderOf(context);
  const wanted = { start: Date.parse(chosen.window.start), end: Date.parse(chosen.window.end) };
  try {
    const offered = await adapter.rates(context, {
      from,
      to,
      parcels: [input.parcel],
      currency: "NOK",
      products: [chosen.serviceId],
      pickupWindows: pickupWindows(Date.now(), {
        hours: context.details.pickupHours ?? "10:00-17:00",
        days: context.details.pickupDays ?? "1-5",
        timeZone: String(store?.time_zone ?? "Europe/Oslo"),
      }),
    });
    const window = offered.find((o) => o.serviceId === chosen.serviceId && o.window && Date.parse(o.window.start) === wanted.start && Date.parse(o.window.end) === wanted.end)?.window;
    if (!window) {
      return { ok: false, problem: "Porterbuddy no longer offers the delivery window the customer chose. Nothing was booked: ask the customer for another time." };
    }
    const booked = await adapter.book(context, {
      orderReference: number,
      // Porterbuddy's idempotency key: one per parcel, so a second parcel of the order is booked, not answered with the first (D372).
      parcelReference: await parcelReference(storeId, orderId, number),
      serviceId: chosen.serviceId,
      from,
      to,
      parcels: [input.parcel],
      window,
    });
    await audit(accountId, storeId, "shipping.porterbuddy_booked", { orderId, test: booked.test });
    if (booked.test) return { ok: true, test: true, trackingNumber: booked.trackingNumber };
    const sent = await markSent(
      storeId,
      orderId,
      { carrier: "porterbuddy", trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl },
      accountId,
      { carrierId: "porterbuddy", consignmentNumber: booked.consignmentNumber, labelUrl: booked.labelUrl },
      { lines: input.lines ?? null },
    );
    // The booking exists at Porterbuddy even if the order could not be marked: say so rather than hide it.
    if (!sent.ok) return { ok: false, problem: `Porterbuddy booked the delivery (${booked.trackingNumber}) but the order could not be marked as sent. ${sendRefusalText(sent.reason)}` };
    return { ok: true, test: false, shipment: sent.shipment };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "Porterbuddy did not answer." };
  }
}
