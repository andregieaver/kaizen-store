import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isBringUrl } from "@/lib/bring";
import { isDhlPaketUrl } from "@/lib/dhl-paket";
import { isHelthjemUrl } from "@/lib/helthjem";
import { isInstaboxUrl } from "@/lib/instabox";
import { isNshiftUrl } from "@/lib/nshift";
import { isPorterbuddyUrl } from "@/lib/porterbuddy";
import { CARRIERS, isCarrierId, type CarrierContext, type CarrierId } from "@/lib/shipping-carriers";
import { labelTrackingNumber } from "@/lib/ups";

import { fetchBringLabel } from "./carriers/bring";
import { fetchDhlPaketLabel } from "./carriers/dhl-paket";
import { fetchHelthjemLabel } from "./carriers/helthjem";
import { fetchInstaboxLabel } from "./carriers/instabox";
import { fetchNshiftLabel } from "./carriers/nshift";
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
  nshift: fetchNshiftLabel,
  // Before the day's closing only: after it, the copy kept from the booking is printed (D458).
  dhl_paket: fetchDhlPaketLabel,
};

/**
 * The PDF label of a shipment booked through a carrier's connection, for the store's staff only: fetched when it is printed with the store's own
 * agreement and never kept (Posten / Bring, Porterbuddy, Helthjem, Instabox, UPS, nShift), or, for a carrier that gives it only in its answer to the
 * booking (DHL Express, PostNord, DHL Paket after the day's closing, D457, D458), the copy kept in `carrier_labels` until the retention run removes it. Null when there is none, the parcel was undone (D174 follow-up) or the
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
  return fetchCarrierLabel(storeId, carrier, String(row.label_url));
}

/** Each carrier's own label hosts: an address anywhere else is never fetched (each fetcher checks again, against the store's environment). */
const LABEL_HOSTS: Partial<Record<CarrierId, (url: string) => boolean>> = {
  bring: isBringUrl,
  porterbuddy: isPorterbuddyUrl,
  helthjem: isHelthjemUrl,
  instabox: isInstaboxUrl,
  ups: (url) => labelTrackingNumber(url) !== null,
  nshift: isNshiftUrl,
  dhl_paket: isDhlPaketUrl,
};

/** Whether a carrier's labels are fetched again from it when printed, and this address is on its own label host. */
export const hasLabelFetcher = (carrier: string, url?: string): boolean =>
  isCarrierId(carrier) && Boolean(FETCHERS[carrier]) && (url === undefined || Boolean(LABEL_HOSTS[carrier]?.(url)));

/**
 * A label fetched from the carrier at an address it gave (a parcel's or a return's, D239), with the store's own agreement; null for a carrier without a
 * fetcher, no agreement, an address on another host (the fetcher refuses it) or a carrier that did not answer.
 */
export async function fetchCarrierLabel(storeId: string, carrier: string, url: string): Promise<Uint8Array | null> {
  if (!isCarrierId(carrier)) return null;
  const fetchLabel = FETCHERS[carrier];
  if (!fetchLabel) return null;
  const context = await carrierContext(storeId, carrier);
  return context ? fetchLabel(context, url) : null;
}

/** The carriers whose labels can be printed from Kaizena Flow: every carrier that books labels, fetched again or kept from the booking. */
export const LABEL_CARRIERS: CarrierId[] = CARRIERS.filter((c) => c.available.includes("labels")).map((c) => c.id);

/** Keeps a label a carrier gives only in its answer (DHL Express, PostNord, DHL Paket) with its parcel, for printing (D457, D458). Never throws: the booking stands without it. */
export async function keepLabel(storeId: string, orderId: string, shipmentId: string, carrier: CarrierId, pdf: Uint8Array): Promise<boolean> {
  try {
    await db().execute(sql`
      insert into commerce.carrier_labels (store_id, shipment_id, order_id, carrier, pdf)
      values (${storeId}::uuid, ${shipmentId}::uuid, ${orderId}::uuid, ${carrier}, ${Buffer.from(pdf)})
      on conflict (store_id, shipment_id) where shipment_id is not null do nothing
    `);
    return true;
  } catch (error) {
    log("warn", "carrier.label_keep_failed", { carrier }, error);
    return false;
  }
}

/**
 * Keeps a return label a carrier gives only in its answer (PostNord, DHL Paket, D458) with the return, for the shopper's link and staff's *Print
 * label*; a label booked again (after a test one) takes its place. Never throws: the return's label stands booked without it, and staff are told.
 */
export async function keepReturnLabel(storeId: string, orderId: string, returnId: string, carrier: CarrierId, pdf: Uint8Array): Promise<boolean> {
  try {
    await db().execute(sql`
      insert into commerce.carrier_labels (store_id, return_id, order_id, carrier, pdf)
      values (${storeId}::uuid, ${returnId}::uuid, ${orderId}::uuid, ${carrier}, ${Buffer.from(pdf)})
      on conflict (store_id, return_id) where return_id is not null do update set carrier = excluded.carrier, pdf = excluded.pdf, created_at = now()
    `);
    return true;
  } catch (error) {
    log("warn", "carrier.return_label_keep_failed", { carrier }, error);
    return false;
  }
}

/** The return label kept for a return, or null. */
export async function keptReturnLabel(storeId: string, returnId: string): Promise<Uint8Array | null> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select pdf from commerce.carrier_labels where store_id = ${storeId}::uuid and return_id = ${returnId}::uuid
  `);
  return row?.pdf ? new Uint8Array(row.pdf as Uint8Array) : null;
}
