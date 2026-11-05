import "server-only";

import {
  billingNumber,
  bookingProblems,
  checkBody,
  DEFAULT_PROFILE,
  dhlPaketHost,
  dhlPaketProblem,
  dhlPaketTrackingPage,
  isDhlPaketUrl,
  labelUrl,
  locationsUrl,
  orderBody,
  parseCancel,
  parseLocations,
  parseOrder,
  parsePickup,
  parseReturn,
  parseToken,
  parseTracking,
  pdfOf,
  pickupBody,
  pickupProblem,
  productFor,
  PICKUP_PATH,
  returnBody,
  returnProblems,
  RETURNS_PATH,
  SHIPPING_PATH,
  TOKEN_PATH,
  tokenBody,
  trackingUrl,
  type PaketAccount,
} from "@/lib/dhl-paket";
import { bookingCustomsProblem, senderAddress, type CarrierContext, type ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * DHL Paket's connection (D458), on the store's own developer-portal app (API key and secret) and Business Customer Portal user: a token by the
 * password grant (kept until a minute before it runs out, asked for again once when refused), shipments and their labels (Parcel DE Shipping),
 * cancelling a shipment before the day's closing, return labels (Parcel DE Returns), a collection at the sender's address (Parcel DE Pickup, which
 * takes the user and password by Basic with the API key), the post offices and Paketshops near the shopper (Location Finder) and tracking (Shipment
 * Tracking - Unified, with the same API key). In the store's test environment the calls go to DHL's sandbox. Every call has a timeout, and an
 * answer that cannot be used is a plain sentence for the owner.
 */

const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown; status: number } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, url: string, init: RequestInit): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "DHL did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json, status: response.status } : { ok: false, problem: dhlPaketProblem(response.status, json), status: response.status, json };
}

/** Tokens by host, app and user, until a minute before they run out. */
const tokens = new Map<string, { token: string; until: number }>();

/** Forgets the tokens kept (a test starts clean). */
export function forgetDhlPaketTokens() {
  tokens.clear();
}

async function tokenFor(fetcher: Fetch, context: CarrierContext, fresh = false): Promise<{ ok: true; token: string } | { ok: false; problem: string }> {
  const host = dhlPaketHost(context.environment);
  const key = `${host}|${context.secrets.apiKey ?? ""}|${context.details.username ?? ""}`;
  const kept = tokens.get(key);
  if (!fresh && kept && kept.until > Date.now()) return { ok: true, token: kept.token };
  const answer = await call(fetcher, `${host}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: tokenBody({ apiKey: context.secrets.apiKey ?? "", apiSecret: context.secrets.apiSecret ?? "", username: context.details.username ?? "", password: context.secrets.password ?? "" }),
  });
  if (!answer.ok) return { ok: false, problem: answer.status === 400 || answer.status === 401 ? dhlPaketProblem(401) : answer.problem };
  const parsed = parseToken(answer.json);
  if (!parsed) return { ok: false, problem: "DHL answered without a token." };
  tokens.set(key, { token: parsed.token, until: Date.now() + Math.max(0, parsed.expiresIn - 60) * 1000 });
  return { ok: true, token: parsed.token };
}

/** A call with the store's token; a token DHL refuses is asked for again once. */
async function authed(fetcher: Fetch, context: CarrierContext, url: string, init: RequestInit = {}): Promise<Answer> {
  for (const fresh of [false, true]) {
    const token = await tokenFor(fetcher, context, fresh);
    if (!token.ok) return { ok: false, problem: token.problem, status: 401, json: null };
    const answer = await call(fetcher, url, {
      ...init,
      headers: { Authorization: `Bearer ${token.token}`, Accept: "application/json", "Accept-Language": "en-US", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (answer.ok || answer.status !== 401 || fresh) return answer;
  }
  return { ok: false, problem: dhlPaketProblem(401), status: 401, json: null };
}

const accountOf = (context: CarrierContext): PaketAccount => ({ ekp: context.details.ekp ?? "", participation: context.details.participation, profile: context.details.profile });
const profileOf = (context: CarrierContext) => context.details.profile?.trim() || DEFAULT_PROFILE;
/** The API key alone (Location Finder and Tracking), which DHL's portal gives the app. */
const keyHeaders = (context: CarrierContext) => ({ "DHL-API-Key": context.secrets.apiKey ?? "", Accept: "application/json" });

export function createDhlPaketAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  return {
    id: "dhl_paket",

    async check(context) {
      // The app and the user (a token), then the EKP and its contract: a sample shipment validated, nothing booked.
      const from = senderAddress(context.details);
      if (from.country !== "DE") return { ok: false, problem: "DHL Paket sends parcels from Germany: set the sender's country to DE on this page." };
      if (!billingNumber(context.details.ekp ?? "", "V01PAK", context.details.participation)) return { ok: false, problem: "The EKP is ten characters and the participation two: check them on this page." };
      const answer = await authed(fetcher, context, `${dhlPaketHost(context.environment)}${SHIPPING_PATH}/orders?validate=true`, { method: "POST", body: JSON.stringify(checkBody(from, accountOf(context))) });
      if (answer.ok) return { ok: true };
      return { ok: false, problem: answer.status === 400 ? dhlPaketProblem(400, answer.json) : answer.problem };
    },

    async pickupPoints(context, near) {
      // Post offices and Paketshops are addressed only in Germany.
      if (near.country.toUpperCase() !== "DE") return [];
      const answer = await call(fetcher, locationsUrl({ postalCode: near.postalCode, city: near.city, street: near.street || undefined }), { headers: keyHeaders(context) });
      if (!answer.ok) throw new Error(answer.problem);
      return parseLocations(answer.json);
    },

    async book(context, request) {
      // A consignment that crosses a customs border is never booked without its customs lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const account = accountOf(context);
      const problems = bookingProblems(request, account);
      if (problems.length > 0) throw new Error(problems[0]);
      const host = dhlPaketHost(context.environment);
      const answer = await authed(fetcher, context, `${host}${SHIPPING_PATH}/orders?includeDocs=include&docFormat=PDF`, { method: "POST", body: JSON.stringify(orderBody(request, account)) });
      if (!answer.ok) throw new Error(answer.status === 400 ? dhlPaketProblem(400, answer.json) : answer.problem);
      const parsed = parseOrder(answer.json);
      if (!parsed.ok) throw new Error(`DHL did not accept the shipment: ${parsed.problem}`);
      // A collection at the sender's address, when asked for: the shipment stands either way.
      let collection: { booked: boolean; confirmation: string | null; problem: string | null } | undefined;
      if (request.collection) {
        const problem = pickupProblem(request.from, request.collection);
        if (problem) collection = { booked: false, confirmation: null, problem };
        else {
          const billing = billingNumber(account.ekp, productFor(request.serviceId, request.to.country)!, account.participation)!;
          const pickup = await call(fetcher, `${host}${PICKUP_PATH}/orders`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${context.details.username ?? ""}:${context.secrets.password ?? ""}`).toString("base64")}`,
              "dhl-api-key": context.secrets.apiKey ?? "",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(pickupBody({ billingNumber: billing, from: request.from, collection: request.collection, shipmentNo: parsed.shipmentNo, reference: request.orderReference })),
          });
          const taken = pickup.ok ? parsePickup(pickup.json) : pickup.status === 422 ? parsePickup(pickup.json) : { ok: false as const, problem: pickup.problem };
          collection = taken.ok ? { booked: true, confirmation: taken.orderId, problem: null } : { booked: false, confirmation: null, problem: taken.problem };
        }
      }
      return {
        trackingNumber: parsed.shipmentNo,
        trackingUrl: dhlPaketTrackingPage(parsed.shipmentNo),
        consignmentNumber: parsed.shipmentNo,
        labelUrl: labelUrl(host, parsed.shipmentNo, profileOf(context)),
        test: context.environment === "test",
        ...(parsed.label ? { labelPdf: parsed.label } : {}),
        ...(request.customs ? { customs: { declared: true, reference: null, problem: null } } : {}),
        ...(collection ? { collection } : {}),
      };
    },

    async cancel(context, shipment) {
      // Only before the day's closing: a manifested shipment can no longer be deleted.
      const url = `${dhlPaketHost(context.environment)}${SHIPPING_PATH}/orders?profile=${encodeURIComponent(profileOf(context))}&shipment=${encodeURIComponent(shipment.trackingNumber)}`;
      const answer = await authed(fetcher, context, url, { method: "DELETE" });
      if (!answer.ok && answer.status !== 400) return { ok: false, problem: answer.problem };
      const parsed = parseCancel(answer.json);
      return parsed.ok ? parsed : { ok: false, problem: `DHL did not cancel the shipment: ${parsed.problem} A shipment is cancelled only before the day's closing.` };
    },

    async bookReturn(context, request) {
      const problems = returnProblems(request);
      if (problems.length > 0) throw new Error(problems[0]);
      const host = dhlPaketHost(context.environment);
      const answer = await authed(fetcher, context, `${host}${RETURNS_PATH}/orders?labelType=SHIPMENT_LABEL&docFormat=PDF`, {
        method: "POST",
        body: JSON.stringify(returnBody(request, context.details.returnReceiverId ?? "")),
      });
      if (!answer.ok) throw new Error(answer.status === 400 ? dhlPaketProblem(400, answer.json) : answer.problem);
      const parsed = parseReturn(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.shipmentNo,
        trackingUrl: dhlPaketTrackingPage(parsed.shipmentNo),
        consignmentNumber: parsed.shipmentNo,
        // DHL gives a return label only in this answer: it is handed on to be kept.
        labelUrl: null,
        test: context.environment === "test",
        ...(parsed.label ? { labelPdf: parsed.label } : {}),
        price: null,
      };
    },

    async track(context, trackingNumber) {
      const answer = await call(fetcher, trackingUrl(dhlPaketHost(context.environment), trackingNumber), { headers: keyHeaders(context) });
      if (!answer.ok) {
        if (answer.status === 404) return [];
        throw new Error(answer.problem);
      }
      return parseTracking(answer.json);
    },
  };
}

/** The PDF label of a booked shipment, fetched again with the store's token, which DHL gives only until the day's closing; null otherwise. */
export async function fetchDhlPaketLabel(context: CarrierContext, url: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!isDhlPaketUrl(url) || !url.startsWith(`${dhlPaketHost(context.environment)}/`)) return null;
  const answer = await authed(fetcher, context, url);
  if (!answer.ok) return null;
  const items = (answer.json as { items?: unknown[] } | null)?.items;
  return Array.isArray(items) && items[0] ? pdfOf((items[0] as { label?: unknown }).label) : null;
}
