import "server-only";

import {
  BRING_API,
  bookingBody,
  bringHeaders,
  bringProblem,
  parseBooking,
  parsePickupPoints,
  parseShippingGuide,
  parseTracking,
  pickupPointsUrl,
  shippingGuideBody,
  trackingApiUrl,
  type BringCredentials,
} from "@/lib/bring";
import { siteUrl } from "@/lib/site";
import type { CarrierContext, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * Posten / Bring's connection (D134), on the store's own agreement: its Mybring user and key and its customer number.
 * Shipping Guide gives the services and what they cost, Pickup Point the places to collect, Booking makes the shipment and
 * its label, Tracking follows it. In the store's test environment Bring is told it is a test (`X-Bring-Test-Indicator`):
 * nothing is shipped and the labels are not valid. Every call has a timeout, and an answer that cannot be used is a
 * plain sentence for the owner, never a thrown error, so a page or checkout never depends on Bring being up.
 */

const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

function credentials(context: CarrierContext): BringCredentials {
  return { apiUid: context.details.apiUid ?? "", apiKey: context.secrets.apiKey ?? "", clientUrl: siteUrl() };
}

async function call(
  fetcher: Fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true; json: unknown; response: Response } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "Bring did not answer. Try again in a moment." };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json, response } : { ok: false, problem: bringProblem(response.status) };
}

export function createBringAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  return {
    id: "bring",

    async check(context) {
      const creds = credentials(context);
      // The user and key: a harmless look-up of a pickup point in Oslo.
      const points = await call(fetcher, pickupPointsUrl("NO", "0150", 1), { headers: bringHeaders(creds) });
      if (!points.ok) return { ok: false, problem: points.problem };
      // The agreement: the services Bring offers this customer number for a small parcel within Oslo.
      const guide = await call(fetcher, `${BRING_API}/shippingguide/api/v2/products`, {
        method: "POST",
        headers: bringHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify(
          shippingGuideBody({
            fromCountry: "NO",
            fromPostalCode: "0150",
            toCountry: "NO",
            toPostalCode: "0150",
            parcels: [{ weightGrams: 1000 }],
            customerNumber: context.details.customerNumber ?? "",
          }),
        ),
      });
      if (!guide.ok) return { ok: false, problem: guide.problem };
      const { options } = parseShippingGuide(guide.json);
      return options.length > 0
        ? { ok: true }
        : { ok: false, problem: "Bring accepted your user and key, but offers no services for this customer number. Check the number." };
    },

    async rates(context, request) {
      const creds = credentials(context);
      const answer = await call(fetcher, `${BRING_API}/shippingguide/api/v2/products`, {
        method: "POST",
        headers: bringHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify(
          shippingGuideBody({
            fromCountry: request.from.country.toUpperCase(),
            fromPostalCode: request.from.postalCode,
            toCountry: request.to.country.toUpperCase(),
            toPostalCode: request.to.postalCode,
            parcels: request.parcels.map((p) => ({
              weightGrams: p.weightGrams,
              lengthCm: p.lengthMm ? p.lengthMm / 10 : undefined,
              widthCm: p.widthMm ? p.widthMm / 10 : undefined,
              heightCm: p.heightMm ? p.heightMm / 10 : undefined,
            })),
            customerNumber: context.details.customerNumber ?? "",
          }),
        ),
      });
      if (!answer.ok) throw new Error(answer.problem);
      return parseShippingGuide(answer.json).options;
    },

    async pickupPoints(context, near) {
      const answer = await call(fetcher, pickupPointsUrl(near.country, near.postalCode), { headers: bringHeaders(credentials(context)) });
      if (!answer.ok) throw new Error(answer.problem);
      return parsePickupPoints(answer.json);
    },

    async book(context, request) {
      const creds = credentials(context);
      const test = context.environment === "test";
      const answer = await call(fetcher, `${BRING_API}/booking/api/create`, {
        method: "POST",
        headers: bringHeaders(creds, { "Content-Type": "application/json", "X-Bring-Test-Indicator": test ? "true" : "false" }),
        body: JSON.stringify(bookingBody(request, context.details.customerNumber ?? "")),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseBooking(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.trackingNumber,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.consignmentNumber || null,
        labelUrl: parsed.labelUrl,
        test,
      };
    },

    async track(context, trackingNumber) {
      const answer = await call(fetcher, trackingApiUrl(trackingNumber), { headers: bringHeaders(credentials(context)) });
      if (!answer.ok) throw new Error(answer.problem);
      return parseTracking(answer.json);
    },
  };
}

/** The label of a booked shipment as a PDF, fetched with the agreement's keys (Bring keeps the label at a link of its own). */
export async function fetchBringLabel(context: CarrierContext, labelUrl: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!/^https:\/\/api\.bring\.com\//.test(labelUrl)) return null;
  try {
    const response = await fetcher(labelUrl, {
      headers: bringHeaders(credentials(context), { Accept: "application/pdf" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
