import "server-only";

import { z } from "zod";

import type { ParcelLine } from "@/lib/fulfilment";
import { collectionFor } from "@/lib/carrier-collection";
import { crossesBorder } from "@/lib/duties";
import { isServiceCode } from "@/lib/nshift";
import { carrierInfo, senderAddress, type ShippingAddress } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { toParty } from "./bring-shipping";
import { adapterFor } from "./carriers";
import { keepLabel } from "./carrier-label";
import { BOOKING_BUSY, bookedServicePrice, bookingPrecheck, oneBookingAtATime, parcelReference, recordLabelCost } from "./carrier-booking";
import { CHECKOUT_SERVICES } from "./delivery-options";
import { bookingCustomsFor } from "./customs";
import { markSent, sendRefusalText, type Shipment } from "./order-admin";
import { getOrder } from "./orders";
import { carrierContext } from "./shipping-carriers";

/**
 * Booking the newer carriers (Instabox, UPS and DHL Express, D457; PostNord, DHL Paket and nShift, D458) from an order, through one path: the
 * delivery the customer chose at checkout with that carrier (its service and pickup point), or, for the carriers in `STAFF_CHOSEN`, a door-to-door
 * service staff choose for an order whose customer chose no carrier (an order on the flat rate is still sent with the store's own agreement). The
 * rest is the other carriers' own (`helthjemBook()`): one booking of an order at a time and a press made before the page showed the last parcel
 * refused (D372), customs lines for a parcel that crosses a customs border (D343), `markSent()` with the tracking number and where the label is for a
 * real booking (a label given only in the answer kept in `carrier_labels`), a collection when asked for (D458), and only a sentence for a test one.
 */

export const DELIVERY_BOOKING_CARRIERS = ["instabox", "ups", "dhl", "postnord", "dhl_paket", "nshift"] as const;
export type DeliveryBookingCarrier = (typeof DELIVERY_BOOKING_CARRIERS)[number];
export const isDeliveryBookingCarrier = (value: string): value is DeliveryBookingCarrier => (DELIVERY_BOOKING_CARRIERS as readonly string[]).includes(value);

/** The carriers whose services staff may choose for an order whose customer chose none of theirs: those that deliver to the door without a pickup point. */
export const STAFF_CHOSEN: Record<DeliveryBookingCarrier, boolean> = { instabox: false, ups: true, dhl: true, postnord: true, dhl_paket: true, nshift: true };

/** The heaviest parcel each takes in one piece (UPS and DHL Express: 70 kg; Instabox's lockers: 20 kg; PostNord's Parcel and nShift's carriers: 35 kg; DHL Paket: 31.5 kg). */
export const MAX_PARCEL_GRAMS: Record<DeliveryBookingCarrier, number> = { instabox: 20_000, ups: 70_000, dhl: 70_000, postnord: 35_000, dhl_paket: 31_500, nshift: 35_000 };

/**
 * The services staff may choose for an order whose customer chose none of the carrier's: the carrier's services delivered to the door, or for nShift
 * the one service code the owner set on its page (`defaultService`), as nShift's services are the store's own. Empty: staff cannot book such an order.
 */
export function staffServices(carrier: DeliveryBookingCarrier, details: Record<string, string>): { id: string; name: string }[] {
  if (!STAFF_CHOSEN[carrier]) return [];
  if (carrier === "nshift") {
    const code = details.defaultService?.trim();
    return isServiceCode(code) ? [{ id: code, name: `nShift ${code}` }] : [];
  }
  return (CHECKOUT_SERVICES[carrier] ?? []).filter((s) => !s.needsPickupPoint).map((s) => ({ id: s.id, name: s.name }));
}

const parcelOf = (carrier: DeliveryBookingCarrier) =>
  z.object({
    weightGrams: z
      .number()
      .int()
      .min(1, "Enter the parcel's weight.")
      .max(MAX_PARCEL_GRAMS[carrier], `${carrierInfo(carrier)?.name ?? carrier} takes at most ${MAX_PARCEL_GRAMS[carrier] / 1000} kg in one parcel.`),
    lengthMm: z.number().int().min(10).max(3000).optional(),
    widthMm: z.number().int().min(10).max(3000).optional(),
    heightMm: z.number().int().min(10).max(3000).optional(),
  });

/** What became of a collection asked for with the booking (D458), when one was. */
export type CollectionOutcome = { booked: boolean; date: string; confirmation: string | null; problem: string | null };

export type CarrierBooked =
  | { ok: true; test: true; trackingNumber: string; collection?: CollectionOutcome }
  | { ok: true; test: false; shipment: Shipment; collection?: CollectionOutcome }
  | { ok: false; problem: string };

/** The service booked: the customer's choice with this carrier, else the one staff chose (UPS and DHL, without a pickup point); null when there is none. */
export function serviceToBook(
  carrier: DeliveryBookingCarrier,
  chosen: { carrier: string; serviceId: string; pickupPoint: { id: string } | null } | null,
  staffServiceId: string | null | undefined,
  details: Record<string, string> = {},
): { serviceId: string; pickupPointId: string | null } | { problem: string } {
  const name = carrierInfo(carrier)?.name ?? carrier;
  if (chosen && chosen.carrier === carrier) return { serviceId: chosen.serviceId, pickupPointId: chosen.pickupPoint?.id ?? null };
  // The customer paid for another carrier's delivery (a pickup point, a window): that carrier books it.
  if (chosen || !STAFF_CHOSEN[carrier]) return { problem: `The customer did not choose ${carrier === "instabox" ? "an" : "a"} ${name} delivery.` };
  const service = staffServices(carrier, details).find((s) => s.id === staffServiceId);
  if (!service) {
    const needsPoint = (CHECKOUT_SERVICES[carrier] ?? []).find((s) => s.id === staffServiceId && s.needsPickupPoint);
    if (needsPoint) return { problem: `${needsPoint.name} needs the customer's pickup point: choose a service delivered to the door.` };
    return { problem: carrier === "nshift" && !isServiceCode(details.defaultService) ? "Set the service for orders without a choice on nShift's page first." : `Choose the ${name} service to book.` };
  }
  return { serviceId: service.id, pickupPointId: null };
}

export async function bookCarrierDelivery(
  accountId: string,
  storeId: string,
  orderId: string,
  carrier: DeliveryBookingCarrier,
  input: {
    parcel: unknown;
    /** The service staff chose (UPS and DHL), for an order whose customer chose none of this carrier's. */
    serviceId?: string | null;
    /** What goes in this parcel (D174); none = everything still to send. */
    lines?: readonly ParcelLine[] | null;
    /** The order's fulfilment as the screen showed it (`OrderFulfilment.basis`); none from a caller that showed nothing (the bulk action). */
    seen?: string | null;
    /**
     * Ask the carrier to collect the parcel (D458), in the store's time zone: the day and window come from the hours on the carrier's page
     * (`collectionFor()`). Only for a carrier with `collection` in its `available` features and hours saved; ignored otherwise.
     */
    collect?: { timeZone: string; now?: Date } | null;
  },
): Promise<CarrierBooked> {
  const name = carrierInfo(carrier)?.name ?? carrier;
  const parcel = parcelOf(carrier).safeParse(input.parcel);
  if (!parcel.success) return { ok: false, problem: parcel.error.issues[0].message };
  const [order, context] = await Promise.all([getOrder(storeId, orderId), carrierContext(storeId, carrier)]);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (!context) return { ok: false, problem: `${name} is not set up: save your details first.` };
  if (order.copied) return { ok: false, problem: "A copied order is history and is never shipped." };
  if (!["paid", "fulfilled"].includes(order.status)) return { ok: false, problem: "Only paid orders can be shipped." };
  if (order.deliveryMethod !== "ship") return { ok: false, problem: "This order is collected or delivered by the store, not shipped." };
  const service = serviceToBook(carrier, order.delivery, input.serviceId, context.details);
  if ("problem" in service) return { ok: false, problem: service.problem };
  const to = toParty(order.shippingAddress, order.email);
  if (!to) return { ok: false, problem: "The order's delivery address is not complete: it needs a name, street, postal code, city and country." };
  if (!to.phone) to.phone = order.billingAddress.phone ?? "";
  const booked = await oneBookingAtATime(orderId, async (): Promise<CarrierBooked> => {
    // What goes in the parcel is checked before the carrier is paid for it (D174); `markSent()` checks it again under the order's lock.
    const unfit = await bookingPrecheck(storeId, orderId, input.lines, input.seen);
    if (unfit) return { ok: false, problem: unfit };
    const adapter = adapterFor(carrier);
    if (!adapter?.book) return { ok: false, problem: `${name} is not available.` };
    const from: ShippingAddress = senderAddress(context.details);
    const info = carrierInfo(carrier);
    const collects = info?.available.includes("collection") && (!info.collectionCountries || info.collectionCountries.includes(from.country));
    const collection = input.collect && collects ? collectionFor(context.details.collectionHours, input.collect.now ?? new Date(), input.collect.timeZone) : null;
    // A parcel that crosses a customs border carries its customs lines (D343); the adapter refuses to book one without them.
    const customs = crossesBorder(from.country, to.country) ? await bookingCustomsFor(storeId, order) : undefined;
    try {
      const made = await adapter.book(context, {
        orderReference: order.number,
        parcelReference: await parcelReference(storeId, orderId, order.number),
        serviceId: service.serviceId,
        from,
        to,
        parcels: [parcel.data],
        ...(service.pickupPointId ? { pickupPointId: service.pickupPointId } : {}),
        ...(customs ? { customs } : {}),
        ...(collection ? { collection } : {}),
      });
      const collected: CollectionOutcome | undefined =
        collection && made.collection ? { booked: made.collection.booked, date: collection.date, confirmation: made.collection.confirmation, problem: made.collection.problem } : undefined;
      await audit(
        accountId,
        storeId,
        carrier === "ups"
          ? "shipping.ups_booked"
          : carrier === "dhl"
            ? "shipping.dhl_booked"
            : carrier === "postnord"
              ? "shipping.postnord_booked"
              : carrier === "dhl_paket"
                ? "shipping.dhl_paket_booked"
                : carrier === "nshift"
                  ? "shipping.nshift_booked"
                  : "shipping.instabox_booked",
        {
        orderId,
        serviceId: service.serviceId,
        test: made.test,
        ...(made.customs ? { customsDeclared: made.customs.declared } : {}),
      });
      if (made.test) return { ok: true, test: true, trackingNumber: made.trackingNumber, ...(collected ? { collection: collected } : {}) };
      const sent = await markSent(
        storeId,
        orderId,
        { carrier, trackingNumber: made.trackingNumber, trackingUrl: made.trackingUrl },
        accountId,
        { carrierId: carrier, consignmentNumber: made.consignmentNumber, labelUrl: made.labelUrl },
        { lines: input.lines ?? null },
      );
      // The booking exists at the carrier even if the order could not be marked: say so rather than hide it.
      if (!sent.ok) return { ok: false, problem: `${name} booked the shipment (${made.trackingNumber}) but the order could not be marked as sent. ${sendRefusalText(sent.reason)}` };
      // A label the carrier gives only once (DHL Express) is kept with the parcel for printing.
      if (made.labelPdf) await keepLabel(storeId, orderId, sent.shipment.id, carrier, made.labelPdf);
      // What the label cost, from the carrier's price for the same parcel when it gives one (D415). nShift's prices are the shopper's checkout
      // prices, not the label's cost, so none is kept for it.
      if (carrier !== "nshift") await recordLabelCost(storeId, sent.shipment.id, from.country, await bookedServicePrice(carrier, context, { serviceId: service.serviceId, from, to, parcels: [parcel.data] }));
      return { ok: true, test: false, shipment: sent.shipment, ...(collected ? { collection: collected } : {}) };
    } catch (error) {
      return { ok: false, problem: error instanceof Error ? error.message : `${name} did not answer.` };
    }
  });
  return booked ?? { ok: false, problem: BOOKING_BUSY };
}
