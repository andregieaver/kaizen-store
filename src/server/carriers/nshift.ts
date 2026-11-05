import "server-only";

import {
  addonCodes,
  bookingProblems,
  checkoutLanguage,
  deliveryCheckoutUrl,
  historyUrl,
  isNshiftUrl,
  labelUrl,
  NSHIFT_API,
  nshiftHeaders,
  nshiftProblem,
  parseCheckout,
  parseHistory,
  parseLabelPdfs,
  parsePickup,
  parseShipment,
  pickupBody,
  PRINT_CONFIG,
  returnShipmentBody,
  shipmentBody,
  type NshiftAccount,
} from "@/lib/nshift";
import { bookingCustomsProblem, senderAddress, type CarrierContext, type ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * nShift Delivery's connection (formerly Unifaun Online), on the store's own nShift account and API key: the options of its delivery checkout at
 * checkout (with their pickup points), shipments printed with the store's carrier service codes, labels made again when they are printed,
 * collections, cancelling, the shipment's status and return labels. nShift books every carrier of the store's own agreements, so which carriers
 * and services a store has is its nShift account's, not this module's. In the store's test environment shipments are booked as tests (nShift
 * prints TEST on the label and sends nothing to the carrier) and no collection is asked for. Every call has a timeout, and an answer that cannot be
 * used is a plain sentence for the owner, so a page or checkout never depends on nShift being up.
 */

const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown; status: number } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, context: CarrierContext, url: string, init: RequestInit = {}): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: nshiftHeaders(context.details.apiKeyId ?? "", context.secrets.apiKey ?? "", init.body ? { "Content-Type": "application/json" } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "nShift did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  return response.ok ? { ok: true, json, status: response.status } : { ok: false, problem: nshiftProblem(response.status, json), status: response.status, json };
}

const accountOf = (context: CarrierContext): NshiftAccount => ({
  senderQuickId: (context.details.senderQuickId ?? "").trim(),
  addons: addonCodes(context.details.addons),
  test: context.environment !== "live",
});

export function createNshiftAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  return {
    id: "nshift",

    async check(context) {
      // The key and, when the store has one, its delivery checkout (for a parcel within the sender's own postal code); else the account's carriers.
      const from = senderAddress(context.details);
      const checkoutId = context.details.checkoutId?.trim();
      const url = checkoutId
        ? deliveryCheckoutUrl({ checkoutId, language: checkoutLanguage(from.country), currency: currencyOf(from.country), to: from, from })
        : `${NSHIFT_API}/meta/lists/partners?language=en`;
      const answer = await call(fetcher, context, url);
      if (answer.ok) return { ok: true };
      if (checkoutId && answer.status === 400) return { ok: false, problem: "nShift did not find that delivery checkout, or it is not set up for this language and currency. Check its id on this page." };
      return { ok: false, problem: answer.problem };
    },

    /**
     * The options of the store's delivery checkout for the postal code, each with nShift's service code as its `serviceId`, the store's price in
     * the currency asked for (as the shopper pays it) and its own pickup points (`pickupPoints` on the option). None without a checkout id.
     */
    async rates(context, request) {
      const checkoutId = context.details.checkoutId?.trim();
      if (!checkoutId) return [];
      const grams = request.parcels.reduce((sum, p) => sum + Math.max(0, p.weightGrams), 0);
      const answer = await call(
        fetcher,
        context,
        deliveryCheckoutUrl({ checkoutId, language: checkoutLanguage(request.to.country), currency: request.currency, to: request.to, from: request.from, weightGrams: grams }),
      );
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseCheckout(answer.json, request.currency);
      return parsed.invalidPostalCode ? [] : parsed.options;
    },

    async book(context, request) {
      // A consignment that crosses a customs border is never booked without its customs lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const account = accountOf(context);
      const problems = bookingProblems(request, account);
      if (problems.length > 0) throw new Error(problems[0]);
      const answer = await call(fetcher, context, `${NSHIFT_API}/shipments`, { method: "POST", body: JSON.stringify(shipmentBody(request, account)) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseShipment(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      // A collection is asked for once the shipment is printed; a test shipment is never collected.
      let collection: { booked: boolean; confirmation: string | null; problem: string | null } | undefined;
      if (request.collection && !account.test) {
        const pickup = await call(fetcher, context, `${NSHIFT_API}/pickup-bookings`, { method: "POST", body: JSON.stringify(pickupBody(parsed.shipmentId, request.collection, request.from)) });
        collection = pickup.ok ? parsePickup(pickup.json) : { booked: false, confirmation: null, problem: pickup.problem };
      }
      return {
        trackingNumber: parsed.trackingNumber,
        trackingUrl: null,
        consignmentNumber: parsed.shipmentId,
        labelUrl: labelUrl(parsed.shipmentId),
        test: account.test,
        ...(request.customs ? { customs: { declared: true, reference: null, problem: null } } : {}),
        ...(collection ? { collection } : {}),
      };
    },

    async bookReturn(context, request) {
      const account = accountOf(context);
      const problems = bookingProblems({ serviceId: request.serviceId, to: request.to, from: request.from }, account);
      if (problems.length > 0) throw new Error(problems[0]);
      const answer = await call(fetcher, context, `${NSHIFT_API}/shipments`, { method: "POST", body: JSON.stringify(returnShipmentBody(request, account)) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseShipment(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return { trackingNumber: parsed.trackingNumber, trackingUrl: null, consignmentNumber: parsed.shipmentId, labelUrl: labelUrl(parsed.shipmentId), test: account.test, price: null };
    },

    async track(context, trackingNumber) {
      for (const field of ["parcelNo", "shipmentNo"] as const) {
        const answer = await call(fetcher, context, historyUrl(field, trackingNumber));
        if (!answer.ok) {
          if (answer.status === 404) return [];
          throw new Error(answer.problem);
        }
        const events = parseHistory(answer.json, trackingNumber);
        if (events.length > 0) return events;
      }
      return [];
    },

    async cancel(context, shipment) {
      const id = shipment.consignmentNumber?.trim();
      if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { ok: false, problem: "This parcel has no nShift shipment to cancel." };
      const answer = await call(fetcher, context, `${NSHIFT_API}/shipments/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (answer.ok) return { ok: true };
      if (answer.status === 404) return { ok: false, problem: "nShift did not find the shipment: it may already be cancelled." };
      return { ok: false, problem: answer.problem };
    },
  };
}

/** The currency a connection check asks the checkout in: the sender's country's own. */
function currencyOf(country: string): string {
  return ({ NO: "NOK", SE: "SEK", DK: "DKK", IS: "ISK", CH: "CHF", GB: "GBP", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN" } as Record<string, string>)[country.toUpperCase()] ?? "EUR";
}

/**
 * The label of a shipment, made again as a PDF when it is printed (nShift keeps a shipment's documents for one hour) with the store's key, and never
 * kept. Only nShift's own shipment document addresses are asked for.
 */
export async function fetchNshiftLabel(context: CarrierContext, url: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!isNshiftUrl(url)) return null;
  const answer = await call(fetcher, context, `${url}?inlinePdf=true`, { method: "POST", body: JSON.stringify(PRINT_CONFIG) });
  return answer.ok ? parseLabelPdfs(answer.json) : null;
}
