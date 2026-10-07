import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { ShippingAddress } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { parcelInput, toParty } from "./bring-shipping";
import { adapterFor } from "./carriers";
import type { ParcelLine } from "@/lib/fulfilment";

import { parcelPrecheck } from "./fulfilment";
import { markSent, sendRefusalText, type Shipment } from "./order-admin";
import { getOrder } from "./orders";
import { carrierContext } from "./shipping-carriers";

type Row = Record<string, unknown>;

export type HelthjemBooked =
  | { ok: true; test: true; trackingNumber: string }
  | { ok: true; test: false; shipment: Shipment }
  | { ok: false; problem: string };

/**
 * Books the delivery the shopper chose at checkout with Helthjem (D138): home delivery, or a service point (the one the
 * shopper chose) with the transport solution the store set for it. Helthjem is asked whether it reaches the address first
 * (for a home delivery), and nothing is booked if it does not. A real booking marks the order as sent with Helthjem's
 * shipment number as the tracking number and keeps where its label is; a test booking (the store's test environment) only
 * says it worked.
 */
export async function helthjemBook(
  accountId: string,
  storeId: string,
  orderId: string,
  input: { parcel: unknown; /** What goes in this parcel (D174); none = everything still to send. */ lines?: readonly ParcelLine[] | null },
): Promise<HelthjemBooked> {
  const parcel = parcelInput.safeParse(input.parcel);
  if (!parcel.success) return { ok: false, problem: parcel.error.issues[0].message };
  const [order, context] = await Promise.all([getOrder(storeId, orderId), carrierContext(storeId, "helthjem")]);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (!context) return { ok: false, problem: "Helthjem is not set up: save your details first." };
  if (order.copied) return { ok: false, problem: "A copied order is history and is never shipped." };
  if (!["paid", "fulfilled"].includes(order.status)) return { ok: false, problem: "Only paid orders can be shipped." };
  const chosen = order.delivery;
  if (!chosen || chosen.carrier !== "helthjem") return { ok: false, problem: "The customer did not choose a Helthjem delivery." };
  const to = toParty(order.shippingAddress, order.email);
  if (!to) return { ok: false, problem: "The order's delivery address is not complete: it needs a name, street, postal code, city and country." };
  if (to.country !== "NO") return { ok: false, problem: "Helthjem delivers to Norway." };
  if (!to.phone) to.phone = order.billingAddress.phone ?? "";

  // A second click (or tab) must not book the same parcel twice.
  const [recent] = await db().execute<Row>(sql`
    select 1 from commerce.shipments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and carrier_id = 'helthjem' and created_at > now() - interval '2 minutes'
  `);
  if (recent) return { ok: false, problem: "This order was just booked with Helthjem. Reload the page to see it." };
  // What goes in the parcel is checked before the carrier is paid for it (D174); `markSent()` checks it again under the order's lock.
  const unfit = await parcelPrecheck(storeId, orderId, input.lines);
  if (unfit) return { ok: false, problem: unfit };

  const adapter = adapterFor("helthjem");
  if (!adapter?.book) return { ok: false, problem: "Helthjem is not available." };
  const from: ShippingAddress = {
    name: context.details.senderName ?? "",
    street: context.details.senderStreet ?? "",
    postalCode: context.details.senderPostalCode ?? "",
    city: context.details.senderCity ?? "",
    country: "NO",
    ...(context.details.senderPhone ? { phone: context.details.senderPhone } : {}),
  };
  try {
    const booked = await adapter.book(context, {
      orderReference: order.number,
      serviceId: chosen.serviceId,
      from,
      to,
      parcels: [parcel.data],
      pickupPointId: chosen.pickupPoint?.id,
    });
    await audit(accountId, storeId, "shipping.helthjem_booked", { orderId, test: booked.test });
    if (booked.test) return { ok: true, test: true, trackingNumber: booked.trackingNumber };
    const sent = await markSent(
      storeId,
      orderId,
      { carrier: "helthjem", trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl },
      accountId,
      { carrierId: "helthjem", consignmentNumber: booked.consignmentNumber, labelUrl: booked.labelUrl },
      { lines: input.lines ?? null },
    );
    // The booking exists at Helthjem even if the order could not be marked: say so rather than hide it.
    if (!sent.ok) return { ok: false, problem: `Helthjem booked the shipment (${booked.trackingNumber}) but the order could not be marked as sent. ${sendRefusalText(sent.reason)}` };
    return { ok: true, test: false, shipment: sent.shipment };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "Helthjem did not answer." };
  }
}
