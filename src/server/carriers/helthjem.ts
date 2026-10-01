import "server-only";

import {
  NO_COVERAGE,
  bookingBody,
  bookingProblems,
  coverageBody,
  errorKey,
  helthjemHost,
  helthjemProblem,
  isHelthjemUrl,
  labelUrl,
  parseBooking,
  parseServicePoints,
  parseToken,
  parseTracking,
  servicePointsBody,
  solutionFor,
  solutionId,
  tokenBody,
  tokenUrl,
  trackingUrl,
} from "@/lib/helthjem";
import type { CarrierContext, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * Helthjem's connection (D138), on the store's own client id and secret: a bearer token (kept until it runs out), coverage
 * checks, the nearest service points, bookings with their labels, and tracking. Prices are not asked of Helthjem (there is
 * no price service): the store enters them for checkout. In the store's test environment the calls go to Helthjem's
 * pre-production API. Every call has a timeout, and an answer that cannot be used is a plain sentence for the owner, so a
 * page or checkout never depends on Helthjem being up.
 */

const TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;

type Answer = { ok: true; json: unknown; response: Response } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, url: string, init: RequestInit): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "Helthjem did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return response.ok ? { ok: true, json, response } : { ok: false, problem: helthjemProblem(response.status, json), status: response.status, json };
}

/** Tokens by host and client, until a minute before they run out. */
const tokens = new Map<string, { token: string; until: number }>();

/** Forgets the tokens kept (a test starts clean, and a refused token is asked for again). */
export function forgetHelthjemTokens() {
  tokens.clear();
}

async function tokenFor(fetcher: Fetch, context: CarrierContext, fresh = false): Promise<{ ok: true; token: string } | { ok: false; problem: string }> {
  const host = helthjemHost(context.environment);
  const key = `${host}|${context.details.clientId ?? ""}`;
  const kept = tokens.get(key);
  if (!fresh && kept && kept.until > Date.now()) return { ok: true, token: kept.token };
  const answer = await call(fetcher, tokenUrl(host), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(tokenBody(context.details.clientId ?? "", context.secrets.clientSecret ?? "")),
  });
  if (!answer.ok) return { ok: false, problem: answer.status === 401 || answer.status === 400 ? helthjemProblem(401) : answer.problem };
  const parsed = parseToken(answer.json);
  if (!parsed) return { ok: false, problem: "Helthjem answered without a token." };
  tokens.set(key, { token: parsed.token, until: Date.now() + Math.max(0, parsed.expiresIn - 60) * 1000 });
  return { ok: true, token: parsed.token };
}

/** A call with the store's token; a token Helthjem refuses is asked for again once. */
async function authed(fetcher: Fetch, context: CarrierContext, path: string, init: RequestInit = {}): Promise<Answer> {
  const host = helthjemHost(context.environment);
  for (const fresh of [false, true]) {
    const token = await tokenFor(fetcher, context, fresh);
    if (!token.ok) return { ok: false, problem: token.problem, status: 401, json: null };
    const answer = await call(fetcher, `${host}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token.token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
    if (answer.ok || answer.status !== 401 || fresh) return answer;
  }
  return { ok: false, problem: helthjemProblem(401), status: 401, json: null };
}

const shopOf = (context: CarrierContext) => solutionId(context.details.shopId);

export function createHelthjemAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  return {
    id: "helthjem",

    async check(context) {
      const shopId = shopOf(context);
      const solution = solutionFor("home", context.details) ?? solutionFor("collect", context.details);
      if (shopId === null || solution === null) return { ok: false, problem: "Add the shop id and a transport solution on this page first." };
      // The credentials (a token), then the shop and transport solution: a coverage check for a known address in Oslo. An
      // address Helthjem does not cover still means the shop and solution were accepted.
      const answer = await authed(fetcher, context, "/parcels/v1/addresses/find/single", {
        method: "POST",
        body: JSON.stringify(coverageBody({ shopId, solution, name: "Test", address: "Kongsberggata 18", zipCode: "0468", city: "Oslo", country: "NO", weightGrams: 1000 })),
      });
      if (answer.ok || (answer.status === 400 && errorKey(answer.json) === NO_COVERAGE)) return { ok: true };
      return { ok: false, problem: answer.problem };
    },

    async pickupPoints(context, near) {
      const shopId = shopOf(context);
      const solution = solutionFor("collect", context.details);
      if (shopId === null || solution === null) throw new Error("Add the transport solution for service point delivery on the carrier's page.");
      const answer = await authed(fetcher, context, "/parcels/v1/service-points/nearby", {
        method: "POST",
        body: JSON.stringify(servicePointsBody({ shopId, solution, street: near.street || undefined, zipCode: near.postalCode, city: near.city || undefined, country: near.country })),
      });
      if (!answer.ok) throw new Error(answer.problem);
      return parseServicePoints(answer.json);
    },

    async book(context, request) {
      const shopId = shopOf(context);
      const solution = solutionFor(request.serviceId, context.details);
      const problems = bookingProblems(request, solution, shopId);
      if (problems.length > 0) throw new Error(problems[0]);
      // Coverage for the full address first: a home delivery Helthjem cannot make is said so before anything is booked.
      if (request.serviceId === "home") {
        const covered = await authed(fetcher, context, "/parcels/v1/addresses/find/single", {
          method: "POST",
          body: JSON.stringify(
            coverageBody({ shopId: shopId!, solution: solution!, name: request.to.name, address: request.to.street, zipCode: request.to.postalCode, city: request.to.city, country: request.to.country, weightGrams: request.parcels[0]?.weightGrams ?? 1000 }),
          ),
        });
        if (!covered.ok) throw new Error(covered.problem);
      }
      const answer = await authed(fetcher, context, "/parcels/v1/bookings", { method: "POST", body: JSON.stringify(bookingBody(request, shopId!, solution!)) });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseBooking(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.shipmentNumber,
        trackingUrl: null,
        consignmentNumber: parsed.shipmentId,
        labelUrl: labelUrl(helthjemHost(context.environment), parsed.shipmentId),
        test: context.environment === "test",
      };
    },

    async track(context, trackingNumber) {
      const host = helthjemHost(context.environment);
      const answer = await authed(fetcher, context, trackingUrl(host, trackingNumber).slice(host.length));
      if (!answer.ok) throw new Error(answer.problem);
      return parseTracking(answer.json);
    },
  };
}

/** The PDF label of a booked shipment, fetched with the store's token when it is printed and never kept. */
export async function fetchHelthjemLabel(context: CarrierContext, url: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!isHelthjemUrl(url)) return null;
  const host = helthjemHost(context.environment);
  if (!url.startsWith(`${host}/`)) return null;
  const token = await tokenFor(fetcher, context);
  if (!token.ok) return null;
  try {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token.token}`, Accept: "application/pdf" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
