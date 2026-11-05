import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isCarrierId, type CarrierContext, type CarrierId } from "@/lib/shipping-carriers";

import { fetchBringLabel } from "./carriers/bring";
import { fetchHelthjemLabel } from "./carriers/helthjem";
import { fetchInstaboxLabel } from "./carriers/instabox";
import { fetchPorterbuddyLabel } from "./carriers/porterbuddy";
import { fetchUpsLabel } from "./carriers/ups";
import { log } from "./log";
import { carrierContext } from "./shipping-carriers";

/** How each carrier's label is fetched again from the carrier with the store's own agreement when it is printed. */
const FETCHERS: Partial<Record<CarrierId, (context: CarrierContext, url: string) => Promise<Uint8Array | null>>> = {
  bring: fetchBringLabel,
  porterbuddy: fetchPorterbuddyLabel,
  helthjem: fetchHelthjemLabel,
  instabox: fetchInstaboxLabel,
  ups: fetchUpsLabel,
};

/**
 * The PDF label of a shipment booked through a carrier's connection, for the store's staff only: fetched when it is printed with the store's own
 * agreement and never kept (Posten / Bring, Porterbuddy, Helthjem, Instabox, UPS), or, for a carrier that gives it only once (DHL Express, D457),
 * the copy kept in `carrier_labels` until the retention run removes it. Null when there is none, the parcel was undone (D174 follow-up) or the
 * carrier will not give it.
 */
export async function carrierLabel(storeId: string, orderId: string, shipmentId: string): Promise<Uint8Array | null> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select s.carrier_id, s.label_url, l.pdf from commerce.shipments s
    left join commerce.carrier_labels l on l.store_id = s.store_id and l.shipment_id = s.id
    where s.store_id = ${storeId}::uuid and s.order_id = ${orderId}::uuid and s.id = ${shipmentId}::uuid and s.label_url is not null and s.undone_at is null
  `);
  if (!row) return null;
  const carrier = String(row.carrier_id);
  if (row.pdf) return new Uint8Array(row.pdf as Uint8Array);
  const fetchLabel = isCarrierId(carrier) ? FETCHERS[carrier] : undefined;
  if (!fetchLabel) return null;
  const context = await carrierContext(storeId, carrier as CarrierId);
  if (!context) return null;
  return fetchLabel(context, String(row.label_url));
}

/** The carriers whose labels can be printed from Kaizena Flow: fetched again, or kept from the booking. */
export const LABEL_CARRIERS: CarrierId[] = [...(Object.keys(FETCHERS) as CarrierId[]), "dhl"];

/** Keeps a label a carrier gives only once (DHL Express) with its parcel, for printing (D457). Never throws: the booking stands without it. */
export async function keepLabel(storeId: string, orderId: string, shipmentId: string, carrier: CarrierId, pdf: Uint8Array): Promise<boolean> {
  try {
    await db().execute(sql`
      insert into commerce.carrier_labels (store_id, shipment_id, order_id, carrier, pdf)
      values (${storeId}::uuid, ${shipmentId}::uuid, ${orderId}::uuid, ${carrier}, ${Buffer.from(pdf)})
      on conflict (store_id, shipment_id) do nothing
    `);
    return true;
  } catch (error) {
    log("warn", "carrier.label_keep_failed", { carrier }, error);
    return false;
  }
}
