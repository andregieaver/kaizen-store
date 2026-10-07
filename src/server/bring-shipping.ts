import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { CarrierId, PickupPoint, ShippingAddress, ShippingOption } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { adapterFor } from "./carriers";
import { fetchBringLabel } from "./carriers/bring";
import type { ParcelLine } from "@/lib/fulfilment";

import { parcelPrecheck } from "./fulfilment";
import { markSent, sendRefusalText, type Shipment } from "./order-admin";
import { getOrder, type Address, type OrderView } from "./orders";
import { carrierContext } from "./shipping-carriers";

type Row = Record<string, unknown>;

/**
 * Shipping an order with Posten / Bring from its page (D134): the services and prices for the parcel, the pickup points
 * near the recipient, the booking (which marks the order as sent, with the tracking number and where the label is) and the
 * connection check. Everything is on the store's own agreement (`carrierContext()`). In the store's test environment Bring
 * books a test shipment: nothing is shipped, so the order is NOT marked as sent.
 */

export type ParcelInput = { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number };

export const parcelInput = z.object({
  weightGrams: z.number().int().min(1, "Enter the parcel's weight.").max(35_000, "Bring takes at most 35 kg in these services."),
  lengthMm: z.number().int().min(10).max(2000).optional(),
  widthMm: z.number().int().min(10).max(2000).optional(),
  heightMm: z.number().int().min(10).max(2000).optional(),
});

/** The weight of what the order's lines hold, in grams, from the variants that have a weight; 0 when none has. */
export async function estimateWeightGrams(storeId: string, orderId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(l.quantity * v.weight_grams), 0)::bigint as grams
    from commerce.order_lines l
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    where l.store_id = ${storeId}::uuid and l.order_id = ${orderId}::uuid and v.weight_grams is not null
  `);
  return Number(row?.grams ?? 0);
}

export const toParty = (address: Address, email: string): ShippingAddress | null => {
  const name = address.name?.trim();
  const street = [address.line1, address.line2].filter(Boolean).join(", ").trim();
  const postalCode = address.postalCode?.trim();
  const city = address.city?.trim();
  const country = address.country?.trim().toUpperCase();
  if (!name || !street || !postalCode || !city || !country) return null;
  return { name, street, postalCode, city, country, ...(address.phone ? { phone: address.phone } : {}), ...(email ? { email } : {}) };
};

async function prepared(storeId: string, orderId: string): Promise<
  | { ok: true; order: OrderView; to: ShippingAddress; context: NonNullable<Awaited<ReturnType<typeof carrierContext>>> }
  | { ok: false; problem: string }
> {
  const [order, context] = await Promise.all([getOrder(storeId, orderId), carrierContext(storeId, "bring")]);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (!context) return { ok: false, problem: "Posten / Bring is not set up: save your agreement details first." };
  const to = toParty(order.shippingAddress, order.email);
  if (!to) return { ok: false, problem: "The order's delivery address is not complete: it needs a name, street, postal code, city and country." };
  if (to.country !== "NO") return { ok: false, problem: "These Bring services are for parcels to Norway." };
  return { ok: true, order, to, context };
}

const sender = (context: { details: Record<string, string> }): ShippingAddress => ({
  name: context.details.senderName ?? "",
  street: context.details.senderStreet ?? "",
  postalCode: context.details.senderPostalCode ?? "",
  city: context.details.senderCity ?? "",
  country: "NO",
  ...(context.details.senderPhone ? { phone: context.details.senderPhone } : {}),
});

export type BringOptions =
  | { ok: true; options: ShippingOption[]; pickupPoints: PickupPoint[]; test: boolean }
  | { ok: false; problem: string };

/** The services Bring offers for this parcel to this order's recipient, and pickup points near them for the ones that need one. */
export async function bringOptionsFor(storeId: string, orderId: string, raw: unknown): Promise<BringOptions> {
  const parcel = parcelInput.safeParse(raw);
  if (!parcel.success) return { ok: false, problem: parcel.error.issues[0].message };
  const found = await prepared(storeId, orderId);
  if (!found.ok) return found;
  const adapter = adapterFor("bring");
  if (!adapter?.rates || !adapter.pickupPoints) return { ok: false, problem: "Bring is not available." };
  try {
    const options = await adapter.rates(found.context, { from: sender(found.context), to: found.to, parcels: [parcel.data], currency: "NOK" });
    if (options.length === 0) return { ok: false, problem: "Bring offers no service for this parcel and address." };
    const pickupPoints = options.some((o) => o.needsPickupPoint) ? await adapter.pickupPoints(found.context, found.to).catch(() => []) : [];
    return { ok: true, options, pickupPoints, test: found.context.environment === "test" };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "Bring did not answer." };
  }
}

export type BringBooked =
  | { ok: true; test: true; trackingNumber: string }
  | { ok: true; test: false; shipment: Shipment }
  | { ok: false; problem: string };

/**
 * Books the chosen service. A real booking marks the order as sent with the tracking number and keeps where its label is;
 * a test booking (the store's test environment) only says it worked.
 */
export async function bringBook(
  accountId: string,
  storeId: string,
  orderId: string,
  input: { serviceId: string; pickupPointId?: string; parcel: unknown; /** What goes in this parcel (D174); none = everything still to send. */ lines?: readonly ParcelLine[] | null },
): Promise<BringBooked> {
  const parcel = parcelInput.safeParse(input.parcel);
  if (!parcel.success) return { ok: false, problem: parcel.error.issues[0].message };
  const found = await prepared(storeId, orderId);
  if (!found.ok) return found;
  if (!["paid", "fulfilled"].includes(found.order.status)) return { ok: false, problem: "Only paid orders can be shipped." };
  if (found.order.copied) return { ok: false, problem: "A copied order is history and is never shipped." };
  // A second click (or a second tab) must not pay Bring for the same parcel twice: one booking per order every two minutes.
  const [recent] = await db().execute<Row>(sql`
    select 1 from commerce.shipments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and carrier_id = 'bring' and created_at > now() - interval '2 minutes'
  `);
  if (recent) return { ok: false, problem: "This order was just booked with Bring. Reload the page to see it." };
  // What goes in the parcel is checked before the carrier is paid for it (D174); `markSent()` checks it again under the order's lock.
  const unfit = await parcelPrecheck(storeId, orderId, input.lines);
  if (unfit) return { ok: false, problem: unfit };
  const adapter = adapterFor("bring");
  if (!adapter?.book) return { ok: false, problem: "Bring is not available." };
  const pickupPointId = input.pickupPointId?.trim() || undefined;
  try {
    const booked = await adapter.book(found.context, {
      orderReference: found.order.number,
      serviceId: input.serviceId,
      from: sender(found.context),
      to: found.to,
      parcels: [parcel.data],
      pickupPointId,
    });
    await audit(accountId, storeId, "shipping.bring_booked", { orderId, serviceId: input.serviceId, test: booked.test });
    if (booked.test) return { ok: true, test: true, trackingNumber: booked.trackingNumber };
    const sent = await markSent(
      storeId,
      orderId,
      { carrier: "bring", trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl },
      accountId,
      { carrierId: "bring", consignmentNumber: booked.consignmentNumber, labelUrl: booked.labelUrl },
      { lines: input.lines ?? null },
    );
    // The booking exists at Bring even if the order could not be marked: say so rather than hide it.
    if (!sent.ok) return { ok: false, problem: `Bring booked the shipment (${booked.trackingNumber}) but the order could not be marked as sent. ${sendRefusalText(sent.reason)}` };
    return { ok: true, test: false, shipment: sent.shipment };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "Bring did not answer." };
  }
}

/** The PDF label of a booked shipment, for the store's staff; null when there is none or Bring will not give it. */
export async function bringLabel(storeId: string, orderId: string, shipmentId: string): Promise<Uint8Array | null> {
  const [row] = await db().execute<Row>(sql`
    select label_url from commerce.shipments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and id = ${shipmentId}::uuid and carrier_id = 'bring'
  `);
  const context = await carrierContext(storeId, "bring");
  if (!row?.label_url || !context) return null;
  return fetchBringLabel(context, String(row.label_url));
}

/** Where a parcel is now, from Bring's tracking; empty when Bring does not answer or does not know the number. */
export async function bringTracking(storeId: string, trackingNumber: string) {
  const context = await carrierContext(storeId, "bring");
  const adapter = adapterFor("bring");
  if (!context || !adapter?.track) return [];
  try {
    return await adapter.track(context, trackingNumber);
  } catch {
    return [];
  }
}

/** Asks a carrier whether the store's agreement works and keeps the answer, for the carrier's page (D134, D136). */
export async function checkCarrier(accountId: string, storeId: string, carrier: CarrierId): Promise<{ ok: true } | { ok: false; problem: string }> {
  const context = await carrierContext(storeId, carrier);
  const adapter = adapterFor(carrier);
  if (!context || !adapter) return { ok: false, problem: "Save all your agreement details first." };
  let result: { ok: true } | { ok: false; problem: string };
  try {
    result = await adapter.check(context);
  } catch (error) {
    result = { ok: false, problem: error instanceof Error ? error.message : "The carrier did not answer." };
  }
  await db().execute(sql`
    update commerce.shipping_carriers set checked_at = now(), check_ok = ${result.ok}, check_message = ${result.ok ? null : result.problem}
    where store_id = ${storeId}::uuid and carrier = ${carrier}
  `);
  await audit(accountId, storeId, "shipping.carrier_checked", { carrier, ok: result.ok });
  return result;
}

/** Asks Bring whether the store's agreement works. */
export const checkBring = (accountId: string, storeId: string) => checkCarrier(accountId, storeId, "bring");
