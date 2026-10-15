import "server-only";

import type { CarrierId, TrackingEvent } from "@/lib/shipping-carriers";

import { adapterFor } from "./carriers";
import { carrierContext } from "./shipping-carriers";

/**
 * Which connected carrier a shipment is with, for following its parcel: the carrier it was booked with, else the name staff
 * gave it when marking the order as sent ("PostNord", "Posten / Bring"). Null for any other carrier.
 */
export function trackedCarrier(shipment: { carrierId: string | null; carrier: string }): CarrierId | null {
  if (shipment.carrierId === "bring" || shipment.carrierId === "postnord" || shipment.carrierId === "porterbuddy" || shipment.carrierId === "helthjem") return shipment.carrierId;
  const name = shipment.carrier.toLowerCase();
  if (name.includes("postnord")) return "postnord";
  if (name.includes("porterbuddy")) return "porterbuddy";
  if (name.includes("helthjem")) return "helthjem";
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

/** What a carrier answered for one parcel (D238 4.5): its events, no agreement saved for it, or a failure (an error, a timeout, an answer that could not be read). */
export type CarrierAnswer = { ok: true; events: TrackingEvent[] } | { ok: false; reason: "no_agreement" | "failed"; detail?: string };

/** How long the poll waits for a carrier (spec 4.5: 4 s). */
export const TRACK_TIMEOUT_MS = 4_000;

/**
 * One parcel's events from its carrier on the store's own agreement (`carrierContext()` only, never another store's), for the tracking poll: unlike
 * `carrierTracking()` it tells a failure from a carrier that has nothing, so the poll can back off. Never throws.
 */
export async function fetchCarrierEvents(storeId: string, carrier: CarrierId, trackingNumber: string, options: { lang?: string; timeoutMs?: number } = {}): Promise<CarrierAnswer> {
  const [context, adapter] = [await carrierContext(storeId, carrier).catch(() => null), adapterFor(carrier)];
  if (!context || !adapter?.track) return { ok: false, reason: "no_agreement" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const events = await Promise.race([
      adapter.track(context, trackingNumber, { lang: options.lang }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), options.timeoutMs ?? TRACK_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, events: Array.isArray(events) ? events : [] };
  } catch (error) {
    return { ok: false, reason: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
