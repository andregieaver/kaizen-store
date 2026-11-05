import "server-only";

import { bookingCustomsProblem, senderAddress, type CarrierContext, type PickupPoint, type ShippingCarrierAdapter } from "@/lib/shipping-carriers";
import {
  basicAuth,
  bookingProblems,
  labelRecoveryBody,
  labelTrackingNumber,
  labelUrl,
  locatorBody,
  locatorUrl,
  parseAccessPoints,
  parseLabelRecovery,
  parsePickup,
  parseRates,
  parseShipment,
  parseToken,
  parseTracking,
  parseVoid,
  pickupBody,
  pickupUrl,
  rateBody,
  ratingUrl,
  returnBookingProblems,
  returnShipBody,
  shipBody,
  shipUrl,
  tokenUrl,
  trackingUrl,
  upsHost,
  upsProblem,
  upsTrackingPage,
  voidUrl,
} from "@/lib/ups";

/**
 * UPS's connection (D457, D458), on the store's own client id and secret and account number: a bearer token (kept until it runs out and asked for again
 * once when refused), Rating, the Locator for UPS Access Points, Shipping (with a collection from the Pickup API when asked, return labels with a return
 * service, and Void to cancel), Tracking, and Label Recovery for the PDF when a label is printed. In the
 * store's test environment the calls go to UPS's customer integration environment (wwwcie.ups.com), where nothing is shipped. Every call has a
 * timeout, and an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on UPS being up.
 */

const TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, url: string, init: RequestInit): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "UPS did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: upsProblem(response.status, json), status: response.status, json };
}

/** Tokens by host and client, until a minute before they run out. */
const tokens = new Map<string, { token: string; until: number }>();

/** Forgets the tokens kept (a test starts clean). */
export function forgetUpsTokens() {
  tokens.clear();
}

async function tokenFor(fetcher: Fetch, context: CarrierContext, fresh = false): Promise<{ ok: true; token: string } | { ok: false; problem: string }> {
  const host = upsHost(context.environment);
  const key = `${host}|${context.details.clientId ?? ""}`;
  const kept = tokens.get(key);
  if (!fresh && kept && kept.until > Date.now()) return { ok: true, token: kept.token };
  const answer = await call(fetcher, tokenUrl(host), {
    method: "POST",
    headers: {
      Authorization: basicAuth(context.details.clientId ?? "", context.secrets.clientSecret ?? ""),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(context.details.accountNumber ? { "x-merchant-id": context.details.accountNumber } : {}),
    },
    body: "grant_type=client_credentials",
  });
  if (!answer.ok) return { ok: false, problem: answer.status === 400 || answer.status === 401 ? upsProblem(401) : answer.problem };
  const parsed = parseToken(answer.json);
  if (!parsed) return { ok: false, problem: "UPS answered without a token." };
  tokens.set(key, { token: parsed.token, until: Date.now() + Math.max(0, parsed.expiresIn - 60) * 1000 });
  return { ok: true, token: parsed.token };
}

/** A call with the store's token and UPS's transaction headers; a token UPS refuses is asked for again once. */
async function authed(fetcher: Fetch, context: CarrierContext, url: string, init: RequestInit = {}): Promise<Answer> {
  for (const fresh of [false, true]) {
    const token = await tokenFor(fetcher, context, fresh);
    if (!token.ok) return { ok: false, problem: token.problem, status: 401, json: null };
    const answer = await call(fetcher, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.token}`,
        Accept: "application/json",
        transId: crypto.randomUUID().replace(/-/g, ""),
        transactionSrc: "kaizenaflow",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (answer.ok || answer.status !== 401 || fresh) return answer;
  }
  return { ok: false, problem: upsProblem(401), status: 401, json: null };
}

const accountOf = (context: CarrierContext) => (context.details.accountNumber ?? "").trim().toUpperCase();

export function createUpsAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  const accessPoints = async (context: CarrierContext, near: Parameters<NonNullable<ShippingCarrierAdapter["pickupPoints"]>>[1]): Promise<PickupPoint[]> => {
    const answer = await authed(fetcher, context, locatorUrl(upsHost(context.environment)), { method: "POST", body: JSON.stringify(locatorBody(near)) });
    if (!answer.ok) throw new Error(answer.problem);
    return parseAccessPoints(answer.json);
  };

  return {
    id: "ups",

    async check(context) {
      // The client id and secret (a token), then the account: a rate for a parcel between two addresses in the sender's country.
      const from = senderAddress(context.details);
      const answer = await authed(fetcher, context, ratingUrl(upsHost(context.environment)), {
        method: "POST",
        body: JSON.stringify(rateBody({ accountNumber: accountOf(context), from, to: from, parcels: [{ weightGrams: 1000 }] })),
      });
      return answer.ok ? { ok: true } : { ok: false, problem: answer.problem };
    },

    async rates(context, request) {
      const answer = await authed(fetcher, context, ratingUrl(upsHost(context.environment)), {
        method: "POST",
        body: JSON.stringify(rateBody({ accountNumber: accountOf(context), from: request.from, to: request.to, parcels: request.parcels })),
      });
      if (!answer.ok) throw new Error(answer.problem);
      return parseRates(answer.json);
    },

    pickupPoints: accessPoints,

    async book(context, request) {
      // A consignment that crosses a customs border is never booked without its customs lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const problems = bookingProblems(request, accountOf(context));
      if (problems.length > 0) throw new Error(problems[0]);
      // The point the shopper chose, looked up again for its address (UPS asks for it with the point's id).
      let point: PickupPoint | null = null;
      if (request.serviceId === "AP") {
        point = (await accessPoints(context, request.to).catch(() => [])).find((p) => p.id === request.pickupPointId) ?? null;
      }
      const host = upsHost(context.environment);
      const answer = await authed(fetcher, context, shipUrl(host), { method: "POST", body: JSON.stringify(shipBody(request, accountOf(context), point)) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseShipment(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      // A collection is a pickup of its own, asked for once the shipment is booked: one that fails leaves the shipment booked and says why (D458).
      let collection: { booked: boolean; confirmation: string | null; problem: string | null } | undefined;
      if (request.collection) {
        const pickup = await authed(fetcher, context, pickupUrl(host), { method: "POST", body: JSON.stringify(pickupBody(request, accountOf(context), [parsed.trackingNumber])) });
        const prn = pickup.ok ? parsePickup(pickup.json) : null;
        collection = prn
          ? { booked: true, confirmation: prn, problem: null }
          : { booked: false, confirmation: null, problem: `UPS booked the shipment, but not the collection${pickup.ok ? "." : `: ${pickup.problem}`} Book one at ups.com, or hand the parcel in.` };
      }
      return {
        trackingNumber: parsed.trackingNumber,
        trackingUrl: upsTrackingPage(parsed.trackingNumber),
        consignmentNumber: parsed.shipmentNumber,
        labelUrl: labelUrl(host, parsed.trackingNumber),
        test: context.environment === "test",
        ...(request.customs ? { customs: { declared: true, reference: null, problem: null } } : {}),
        ...(collection ? { collection } : {}),
      };
    },

    async bookReturn(context, request) {
      const problems = returnBookingProblems(request, accountOf(context));
      if (problems.length > 0) throw new Error(problems[0]);
      const host = upsHost(context.environment);
      const answer = await authed(fetcher, context, shipUrl(host), { method: "POST", body: JSON.stringify(returnShipBody(request, accountOf(context))) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseShipment(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.trackingNumber,
        trackingUrl: upsTrackingPage(parsed.trackingNumber),
        consignmentNumber: parsed.shipmentNumber,
        // The return label is fetched again as a PDF from Label Recovery when the shopper or staff print it.
        labelUrl: labelUrl(host, parsed.trackingNumber),
        test: context.environment === "test",
        price: parsed.price ? { ...parsed.price, vatIncluded: false } : null,
      };
    },

    async cancel(context, shipment) {
      // UPS voids a shipment by its identification number (the first package's 1Z number) until it is handed over.
      const number = (shipment.consignmentNumber || shipment.trackingNumber).trim();
      if (!/^1Z[A-Z0-9]{16}$/i.test(number)) return { ok: false, problem: "This is not a UPS shipment number, so UPS cannot cancel it." };
      const answer = await authed(fetcher, context, voidUrl(upsHost(context.environment), number), { method: "DELETE" });
      if (!answer.ok) return { ok: false, problem: answer.problem };
      return parseVoid(answer.json) ? { ok: true } : { ok: false, problem: "UPS did not cancel the shipment: it may already be on its way. Check it at ups.com." };
    },

    async track(context, trackingNumber) {
      const answer = await authed(fetcher, context, trackingUrl(upsHost(context.environment), trackingNumber));
      if (!answer.ok) {
        if (answer.status === 404) return [];
        throw new Error(answer.problem);
      }
      return parseTracking(answer.json);
    },
  };
}

/** The PDF label of a booked shipment, from Label Recovery with the store's token when it is printed, and never kept. */
export async function fetchUpsLabel(context: CarrierContext, url: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  const found = labelTrackingNumber(url);
  if (!found || found.host !== upsHost(context.environment)) return null;
  const answer = await authed(fetcher, context, `${found.host}/api/labels/v1/recovery`, { method: "POST", body: JSON.stringify(labelRecoveryBody(found.trackingNumber)) });
  return answer.ok ? parseLabelRecovery(answer.json) : null;
}
