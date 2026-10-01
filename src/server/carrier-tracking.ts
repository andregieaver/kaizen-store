import "server-only";

import type { CarrierId, TrackingEvent } from "@/lib/shipping-carriers";

import { adapterFor } from "./carriers";
import { carrierContext } from "./shipping-carriers";

/**
 * Which connected carrier a shipment is with, for following its parcel: the carrier it was booked with, else the name staff
 * gave it when marking the order as sent ("PostNord", "Posten / Bring"). Null for any other carrier.
 */
export function trackedCarrier(shipment: { carrierId: string | null; carrier: string }): CarrierId | null {
  if (shipment.carrierId === "bring" || shipment.carrierId === "postnord" || shipment.carrierId === "porterbuddy") return shipment.carrierId;
  const name = shipment.carrier.toLowerCase();
  if (name.includes("postnord")) return "postnord";
  if (name.includes("porterbuddy")) return "porterbuddy";
  if (name.includes("bring")) return "bring";
  return null;
}

/** Where a parcel is now, from the carrier's tracking on the store's own agreement; empty when it does not answer or does not know the number. */
export async function carrierTracking(storeId: string, carrier: CarrierId, trackingNumber: string): Promise<TrackingEvent[]> {
  const [context, adapter] = [await carrierContext(storeId, carrier), adapterFor(carrier)];
  if (!context || !adapter?.track) return [];
  try {
    return await adapter.track(context, trackingNumber);
  } catch {
    return [];
  }
}
