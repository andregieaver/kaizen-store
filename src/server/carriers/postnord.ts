import "server-only";

import {
  PICKUP_COUNTRIES,
  SAMPLE_POSTAL_CODES,
  applicationIdOf,
  bookingProblems,
  ediBody,
  ediLabelsUrl,
  labelAddress,
  parseBooking,
  parsePickup,
  parseServicePoints,
  parseTracking,
  pickupBody,
  pickupsUrl,
  postnordHost,
  postnordProblem,
  returnBody,
  returnLabelsUrl,
  servicePointByIdUrl,
  servicePointsUrl,
  trackingUrl,
} from "@/lib/postnord";
import { bookingCustomsProblem, senderAddress, type BookingResult, type CarrierContext, type PickupPoint, type ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * PostNord's connection (D136, booking D459), on the store's own API key and customer number: the service point search for where to collect,
 * Track and Trace for where a parcel is, a check that the key works, and the Booking APIs v3: a booking with its PDF label in one call, return
 * labels (Return Drop Off) and a pickup of the booked parcels from Sweden, Denmark or Finland. Prices are not asked of PostNord (there is no
 * price API): the store enters them for checkout. In the store's test environment the calls go to PostNord's sandbox. Every call has a timeout,
 * and an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on PostNord being up. PostNord's guide
 * documents no call that cancels a booking, so there is no `cancel()`.
 */

const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown } | { ok: false; problem: string; status: number };

async function call(fetcher: Fetch, url: string, init: RequestInit = {}): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "PostNord did not answer. Try again in a moment.", status: 0 };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: postnordProblem(response.status, json), status: response.status };
}

export function createPostnordAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  const host = (context: CarrierContext) => postnordHost(context.environment);
  const key = (context: CarrierContext) => context.secrets.apiKey ?? "";
  const customerNumber = (context: CarrierContext) => (context.details.customerNumber ?? "").trim();

  /** The service point the shopper chose, looked up again for the name and address its booking carries; null when PostNord does not answer. */
  async function servicePoint(context: CarrierContext, country: string, id: string): Promise<PickupPoint | null> {
    const answer = await call(fetcher, servicePointByIdUrl(host(context), key(context), country, id));
    return answer.ok ? (parseServicePoints(answer.json).find((p) => p.id === id) ?? null) : null;
  }

  return {
    id: "postnord",

    async check(context) {
      // The key: a harmless look-up of the service points near a postal code in Stockholm.
      const answer = await call(fetcher, servicePointsUrl(host(context), key(context), "SE", SAMPLE_POSTAL_CODES.SE, 1));
      return answer.ok ? { ok: true } : { ok: false, problem: answer.problem };
    },

    async pickupPoints(context, near) {
      const answer = await call(fetcher, servicePointsUrl(host(context), key(context), near.country, near.postalCode, 5));
      if (!answer.ok) throw new Error(answer.problem);
      return parseServicePoints(answer.json);
    },

    async book(context, request) {
      // A consignment that crosses a customs border (Norway and the EU) is never booked without its customs lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const applicationId = applicationIdOf(context.details, context.environment);
      const problems = bookingProblems(request, { customerNumber: customerNumber(context), applicationId });
      if (problems.length > 0) throw new Error(problems[0]);
      const point = request.pickupPointId ? await servicePoint(context, request.to.country, request.pickupPointId) : null;
      const { body, customs } = ediBody(request, { customerNumber: customerNumber(context), applicationId: applicationId!, servicePoint: point });
      const answer = await call(fetcher, ediLabelsUrl(host(context), key(context)), { method: "POST", body: JSON.stringify(body) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseBooking(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      const result: BookingResult = {
        trackingNumber: parsed.itemId,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.bookingId,
        labelUrl: parsed.label ? labelAddress(host(context), parsed.itemId) : null,
        test: context.environment === "test",
        ...(parsed.label ? { labelPdf: parsed.label } : {}),
        ...(customs ? { customs: { ...customs, reference: null } } : {}),
      };
      if (!request.collection) return result;
      // The pickup is its own booking: the parcel stands booked either way, and staff are told when PostNord did not take it.
      if (!PICKUP_COUNTRIES.includes(request.from.country.toUpperCase())) {
        return { ...result, collection: { booked: false, confirmation: null, problem: "PostNord books pickups from Sweden, Denmark and Finland only: hand the parcel in, or book a pickup with PostNord." } };
      }
      const pickup = await call(fetcher, pickupsUrl(host(context), key(context)), {
        method: "POST",
        body: JSON.stringify(pickupBody({ ...request, collection: request.collection }, { customerNumber: customerNumber(context), applicationId: applicationId! })),
      });
      const confirmation = pickup.ok ? parsePickup(pickup.json) : null;
      return {
        ...result,
        collection: confirmation
          ? { booked: true, confirmation, problem: null }
          : { booked: false, confirmation: null, problem: `PostNord did not book the pickup${pickup.ok ? "" : `: ${pickup.problem}`}. Book it with PostNord, or hand the parcel in.` },
      };
    },

    async bookReturn(context, request) {
      const applicationId = applicationIdOf(context.details, context.environment);
      if (!applicationId) throw new Error("Add the application id PostNord gave you for live bookings (ask apisupport@postnord.com) on the carrier's page.");
      if (!/^\d{1,17}$/.test(customerNumber(context))) throw new Error("The customer number is missing: add it on the carrier's page.");
      const storeCountry = senderAddress(context.details).country;
      const answer = await call(fetcher, returnLabelsUrl(host(context), key(context)), {
        method: "POST",
        body: JSON.stringify(returnBody(request, { customerNumber: customerNumber(context), applicationId, storeCountry })),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseBooking(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.itemId,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.bookingId,
        labelUrl: parsed.label ? labelAddress(host(context), parsed.itemId) : null,
        test: context.environment === "test",
        ...(parsed.label ? { labelPdf: parsed.label } : {}),
        price: null,
      };
    },

    async track(context, trackingNumber) {
      const answer = await call(fetcher, trackingUrl(host(context), key(context), trackingNumber));
      if (!answer.ok) throw new Error(answer.problem);
      return parseTracking(answer.json);
    },
  };
}
