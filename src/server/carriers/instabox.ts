import "server-only";

import {
  HOME_PRODUCT,
  LOCKER_PRODUCT,
  RETURN_PRODUCT,
  bookingProblems,
  deliveryOptionsUrl,
  instaboxHeaders,
  instaboxHost,
  instaboxProblem,
  isInstaboxUrl,
  labelUrl,
  orderBody,
  parseHomeAvailability,
  parseLockers,
  parseOrder,
  readLockerChoice,
  returnBookingProblems,
  returnOrderBody,
} from "@/lib/instabox";
import { bookingCustomsProblem, type CarrierContext, type ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * Instabox's connection (D457, D458), through Instabee's integration API on the store's own API key: the lockers near a postal code (each with the
 * availability token a booking names), orders booked and confirmed as packed at once (to a locker, or home after Instabee confirms the postal code),
 * returns dropped at the locker nearest the shopper, and the label as a PDF when it is printed. Instabee documents no cancel call, so this connection
 * has no `cancel`. Prices are not
 * asked of Instabox: the store enters them for checkout. In the store's test environment the calls go to Instabee's sandbox. Every call has a timeout,
 * and an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on Instabox being up.
 */

const TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;
type Answer = { ok: true; json: unknown } | { ok: false; problem: string; status: number; json: unknown };

async function call(fetcher: Fetch, context: CarrierContext, url: string, init: RequestInit = {}): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: instaboxHeaders(context.secrets.apiKey ?? "", init.body ? { "Content-Type": "application/json" } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "Instabox did not answer. Try again in a moment.", status: 0, json: null };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: instaboxProblem(response.status, json), status: response.status, json };
}

export function createInstaboxAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  const lockers = async (context: CarrierContext, country: string, postalCode: string, product: string = LOCKER_PRODUCT) => {
    const answer = await call(fetcher, context, deliveryOptionsUrl(instaboxHost(context.environment), country, postalCode, product));
    if (!answer.ok) {
      // A postal code Instabox does not reach has no lockers.
      if (answer.status === 404) return { token: null, lockers: [] };
      throw new Error(answer.problem);
    }
    return parseLockers(answer.json);
  };

  return {
    id: "instabox",

    async check(context) {
      // The key: the lockers near Stockholm Central. A key Instabee refuses is a 401 or 403.
      const answer = await call(fetcher, context, deliveryOptionsUrl(instaboxHost(context.environment), "SE", "11120"));
      return answer.ok || answer.status === 404 ? { ok: true } : { ok: false, problem: answer.problem };
    },

    async pickupPoints(context, near) {
      return (await lockers(context, near.country, near.postalCode)).lockers;
    },

    async book(context, request) {
      // Instabox delivers within Sweden, Norway and Denmark; a consignment across a customs border is never booked without its lines (D343).
      const missingCustoms = bookingCustomsProblem(request);
      if (missingCustoms) throw new Error(missingCustoms);
      const problems = bookingProblems(request);
      if (problems.length > 0) throw new Error(problems[0]);
      const host = instaboxHost(context.environment);
      const collectionPointId = context.details.collectionPointId?.trim() || undefined;
      if (request.serviceId === "home") {
        // Home delivery is offered at the store's price everywhere it ships with Instabox; whether Instabox reaches the postal code is asked here.
        const available = await call(fetcher, context, deliveryOptionsUrl(host, request.to.country, request.to.postalCode, HOME_PRODUCT));
        if (!available.ok) throw new Error(available.status === 404 ? "Instabox does not deliver home to that postal code. Send the order another way." : available.problem);
        const home = parseHomeAvailability(available.json);
        const made = await call(fetcher, context, `${host}/orders`, { method: "PUT", body: JSON.stringify(orderBody(request, home.token, home.sortCode, collectionPointId)) });
        if (!made.ok) throw new Error(made.problem);
        const order = parseOrder(made.json);
        if (!order.ok) throw new Error(order.problem);
        return { trackingNumber: order.parcelId, trackingUrl: order.trackingUrl, consignmentNumber: order.orderId, labelUrl: labelUrl(host, order.orderId), test: context.environment === "test" };
      }
      const chosen = readLockerChoice(request.pickupPointId!);
      // The token the shopper's choice came with holds 14 days; without one (or a choice kept without it) the lockers are asked for again.
      let token = chosen.token;
      if (!token) {
        const fresh = await lockers(context, request.to.country, request.to.postalCode);
        if (!fresh.lockers.some((l) => readLockerChoice(l.id).sortCode === chosen.sortCode)) {
          throw new Error("Instabox no longer offers the locker the customer chose. Ask the customer to choose another, or send the order another way.");
        }
        token = fresh.token;
      }
      if (!token) throw new Error("Instabox did not give an availability token for the locker.");
      const answer = await call(fetcher, context, `${host}/orders`, {
        method: "PUT",
        body: JSON.stringify(orderBody(request, token, chosen.sortCode, collectionPointId)),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseOrder(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.parcelId,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.orderId,
        labelUrl: labelUrl(host, parsed.orderId),
        test: context.environment === "test",
      };
    },

    async bookReturn(context, request) {
      // The shopper drops the parcel at the Instabox locker nearest them that takes returns, with the label printed from the return's link.
      const problems = returnBookingProblems(request);
      if (problems.length > 0) throw new Error(problems[0]);
      const near = await lockers(context, request.from.country, request.from.postalCode, RETURN_PRODUCT);
      const locker = near.lockers[0];
      if (!locker || !near.token) throw new Error("Instabox has no locker for returns near the customer's postal code.");
      const host = instaboxHost(context.environment);
      const answer = await call(fetcher, context, `${host}/orders`, {
        method: "PUT",
        body: JSON.stringify(returnOrderBody(request, near.token, readLockerChoice(locker.id).sortCode)),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseOrder(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.parcelId,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.orderId,
        labelUrl: labelUrl(host, parsed.orderId),
        test: context.environment === "test",
        price: null,
      };
    },
  };
}

/** The PDF label of a booked order, fetched with the store's key when it is printed and never kept. */
export async function fetchInstaboxLabel(context: CarrierContext, url: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!isInstaboxUrl(url) || !url.startsWith(`${instaboxHost(context.environment)}/`)) return null;
  try {
    const response = await fetcher(url, {
      headers: { ...instaboxHeaders(context.secrets.apiKey ?? ""), Accept: "application/pdf" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? bytes : null;
  } catch {
    return null;
  }
}
