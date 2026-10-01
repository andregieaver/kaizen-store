import "server-only";

import {
  availabilityBody,
  isPorterbuddyUrl,
  orderBody,
  orderProblems,
  parseAvailability,
  parseLabelInfo,
  parseOrder,
  parseStatus,
  pickupWindows,
  porterbuddyHost,
  porterbuddyProblem,
} from "@/lib/porterbuddy";
import type { CarrierContext, ShippingAddress, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * Porterbuddy's connection (D137), on the store's own API key: availability gives the delivery windows with their prices
 * (what checkout offers), the order is placed for the window the shopper chose, the label and the order's status are read
 * back. In the store's test environment the calls go to Porterbuddy's test API, where nothing is delivered. Every call has
 * a timeout, and an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on
 * Porterbuddy being up.
 */

const TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;

async function call(
  fetcher: Fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true; json: unknown } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "Porterbuddy did not answer. Try again in a moment." };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: porterbuddyProblem(response.status) };
}

const headers = (context: CarrierContext, extra: Record<string, string> = {}) => ({
  "x-api-key": context.secrets.apiKey ?? "",
  Accept: "application/json",
  ...extra,
});

/** The store's own address, as the sender: Porterbuddy collects the goods here. */
export function senderOf(context: CarrierContext): ShippingAddress {
  return {
    name: context.details.senderName ?? "",
    street: context.details.senderStreet ?? "",
    postalCode: context.details.senderPostalCode ?? "",
    city: context.details.senderCity ?? "",
    country: "NO",
    phone: context.details.senderPhone ?? "",
    email: context.details.senderEmail ?? "",
  };
}

export function createPorterbuddyAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  const host = (context: CarrierContext) => porterbuddyHost(context.environment);
  return {
    id: "porterbuddy",

    async check(context) {
      // The key: an availability request for a small parcel across Oslo. An empty answer is fine: the key was accepted.
      const answer = await call(fetcher, `${host(context)}/availability`, {
        method: "POST",
        headers: headers(context, { "Content-Type": "application/json" }),
        body: JSON.stringify(
          availabilityBody({
            from: { name: "", street: "Keysers gate 3", postalCode: "0165", city: "Oslo", country: "NO" },
            to: { name: "", street: "Høyenhallveien 25", postalCode: "0678", city: "Oslo", country: "NO" },
            pickupWindows: pickupWindows(Date.now(), { hours: "10:00-17:00", days: "1-7", timeZone: "Europe/Oslo" }),
            products: ["delivery"],
            parcels: [{ weightGrams: 1000 }],
          }),
        ),
      });
      return answer.ok ? { ok: true } : { ok: false, problem: answer.problem };
    },

    async rates(context, request) {
      const windows = request.pickupWindows ?? pickupWindows(Date.now(), { hours: context.details.pickupHours ?? "10:00-17:00", days: context.details.pickupDays ?? "1-5", timeZone: "Europe/Oslo" });
      if (windows.length === 0) return [];
      const answer = await call(fetcher, `${host(context)}/availability`, {
        method: "POST",
        headers: headers(context, { "Content-Type": "application/json" }),
        body: JSON.stringify(
          availabilityBody({ from: request.from, to: request.to, pickupWindows: windows, products: request.products ?? ["delivery"], parcels: request.parcels }),
        ),
      });
      if (!answer.ok) throw new Error(answer.problem);
      return parseAvailability(answer.json);
    },

    async book(context, request) {
      const problems = orderProblems(request);
      if (problems.length > 0) throw new Error(problems[0]);
      const answer = await call(fetcher, `${host(context)}/order`, {
        method: "POST",
        // The same order is never placed twice, whatever is retried.
        headers: headers(context, { "Content-Type": "application/json", "Idempotency-Key": request.orderReference }),
        body: JSON.stringify(orderBody(request)),
      });
      if (!answer.ok) throw new Error(answer.problem);
      const parsed = parseOrder(answer.json);
      if (!parsed.ok) throw new Error(parsed.problem);
      return {
        trackingNumber: parsed.orderId,
        trackingUrl: parsed.trackingUrl,
        consignmentNumber: parsed.orderId,
        labelUrl: parsed.labelInfoUrl,
        test: context.environment === "test",
      };
    },

    async track(context, trackingNumber) {
      const answer = await call(fetcher, `${host(context)}/order/${encodeURIComponent(trackingNumber)}/status`, { headers: headers(context) });
      if (!answer.ok) throw new Error(answer.problem);
      return parseStatus(answer.json);
    },
  };
}

/**
 * The PDF label of a booked order, fetched when it is printed and never kept: the label info (which holds short-lived
 * addresses) is read with the store's key, then the label document it points to.
 */
export async function fetchPorterbuddyLabel(context: CarrierContext, labelInfoUrl: string, fetcher: Fetch = fetch): Promise<Uint8Array | null> {
  if (!isPorterbuddyUrl(labelInfoUrl)) return null;
  const info = await call(fetcher, labelInfoUrl, { headers: headers(context) });
  if (!info.ok) return null;
  const documentUrl = parseLabelInfo(info.json);
  if (!documentUrl || !isPorterbuddyUrl(documentUrl)) return null;
  try {
    const response = await fetcher(documentUrl, { headers: { Accept: "application/pdf" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
