import "server-only";

import { crossesBorder } from "@/lib/duties";
import {
  addressValidateUrl,
  bookingProblems,
  dhlHeaders,
  dhlHost,
  DHL_SERVICES,
  dhlProblem,
  dhlTrackingPage,
  parseCity,
  parseRates,
  parseServicePoints,
  parseShipment,
  parseTracking,
  ratesBody,
  shipmentBody,
  servicePointsUrl,
  shipmentUrl,
  trackingUrl,
  type DhlProduct,
} from "@/lib/dhl";
import { bookingCustomsProblem, senderAddress, type CarrierContext, type ShippingAddress, type ShippingCarrierAdapter, type ShippingOption } from "@/lib/shipping-carriers";

/**
 * DHL Express's connection (D458, D459), through the MyDHL API on the store's own API key, secret and account number: Address Validate (the city of
 * the shopper's postal code, which Rates needs), Rates, the ServicePoint search, Shipments (with a collection when asked for) and Tracking. MyDHL has
 * no call to cancel a shipment (only a pickup), so this connection has no `cancel`. In the store's test environment the calls go to DHL's test host, where
 * nothing is shipped. The label comes back only in the booking's answer, so it is handed on (`labelPdf`) to be kept in `carrier_labels`. Every call
 * has a timeout, and an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on DHL being up.
 */

const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, context: CarrierContext, url: string, init: RequestInit = {}, options: { version?: boolean } = {}): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: dhlHeaders(context.secrets.apiKey ?? "", context.secrets.apiSecret ?? "", init.body ? { "Content-Type": "application/json" } : {}, options),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "DHL did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: dhlProblem(response.status, json), status: response.status, json };
}

const accountOf = (context: CarrierContext) => (context.details.accountNumber ?? "").replace(/\s+/g, "");

/** The address with its city: as given, else the one DHL knows for the postal code (checkout asks only for the postal code). */
async function withCity(fetcher: Fetch, context: CarrierContext, address: ShippingAddress): Promise<ShippingAddress> {
  if (address.city.trim()) return address;
  const answer = await call(fetcher, context, addressValidateUrl(dhlHost(context.environment), address.country, address.postalCode));
  if (!answer.ok) throw new Error(answer.problem);
  const city = parseCity(answer.json);
  if (!city) throw new Error("DHL does not know that postal code.");
  return { ...address, city };
}

export function createDhlAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter & { products(context: CarrierContext, request: Parameters<NonNullable<ShippingCarrierAdapter["rates"]>>[1]): Promise<DhlProduct[]> } {
  async function products(context: CarrierContext, request: Parameters<NonNullable<ShippingCarrierAdapter["rates"]>>[1]): Promise<DhlProduct[]> {
    const to = await withCity(fetcher, context, request.to);
    const answer = await call(fetcher, context, `${dhlHost(context.environment)}/rates`, {
      method: "POST",
      body: JSON.stringify(ratesBody({ accountNumber: accountOf(context), from: request.from, to, parcels: request.parcels, declarable: crossesBorder(request.from.country, to.country) })),
    });
    if (!answer.ok) throw new Error(answer.problem);
    return parseRates(answer.json);
  }

  return {
    id: "dhl",
    products,

    async check(context) {
      // The key and secret, then the account: a rate for a parcel within the sender's own city.
      const from = senderAddress(context.details);
      try {
        await products(context, { from, to: from, parcels: [{ weightGrams: 1000 }], currency: "EUR" });
        return { ok: true };
      } catch (error) {
        return { ok: false, problem: error instanceof Error ? error.message : "DHL did not answer." };
      }
    },

    async rates(context, request) {
      // The product code is DHL's own, for booking; the option the shopper sees is the store's service.
      return (await products(context, request)).map((product): ShippingOption => {
        const option: ShippingOption & { productCode?: string } = { ...product };
        delete option.productCode;
        return option;
      });
    },

    async pickupPoints(context, near) {
      // The ServicePoint search names no version, and says "No Service Points found" with status 201 in a 200 answer.
      const answer = await call(fetcher, context, servicePointsUrl(dhlHost(context.environment), near), {}, { version: false });
      if (!answer.ok) {
        if (answer.status === 404) return [];
        throw new Error(answer.problem);
      }
      return parseServicePoints(answer.json);
    },

    async book(context, request) {
      // A consignment that crosses a customs border is never booked without its customs lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const problems = bookingProblems(request, accountOf(context));
      if (problems.length > 0) throw new Error(problems[0]);
      // DHL names a product per lane: the one Rates gives this parcel for the store's service is the one booked.
      const offered = await products(context, { from: request.from, to: request.to, parcels: request.parcels, currency: "EUR" });
      const product = offered.find((p) => p.serviceId === request.serviceId);
      if (!product) throw new Error(`DHL does not offer ${DHL_SERVICES.find((s) => s.id === request.serviceId)?.name ?? "that service"} for this parcel. Choose another service.`);
      const declarable = crossesBorder(request.from.country, request.to.country);
      const host = dhlHost(context.environment);
      const answer = await call(fetcher, context, `${host}/shipments`, {
        method: "POST",
        body: JSON.stringify(shipmentBody(request, { accountNumber: accountOf(context), productCode: product.productCode, declarable })),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseShipment(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.trackingNumber,
        trackingUrl: dhlTrackingPage(parsed.trackingNumber),
        consignmentNumber: parsed.trackingNumber,
        labelUrl: parsed.label ? shipmentUrl(host, parsed.trackingNumber) : null,
        test: context.environment === "test",
        ...(parsed.label ? { labelPdf: parsed.label } : {}),
        ...(declarable && request.customs ? { customs: { declared: true, reference: null, problem: null } } : {}),
        // DHL books the collection with the shipment: its dispatch confirmation number says it did (D459).
        ...(request.collection
          ? {
              collection: parsed.dispatchConfirmation
                ? { booked: true, confirmation: parsed.dispatchConfirmation, problem: null }
                : { booked: false, confirmation: null, problem: "DHL booked the shipment without a collection. Book one in MyDHL, or hand the parcel in." },
            }
          : {}),
      };
    },

    async track(context, trackingNumber) {
      const answer = await call(fetcher, context, trackingUrl(dhlHost(context.environment), trackingNumber));
      if (!answer.ok) {
        if (answer.status === 404) return [];
        throw new Error(answer.problem);
      }
      return parseTracking(answer.json);
    },
  };
}
