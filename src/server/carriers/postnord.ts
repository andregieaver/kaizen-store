import "server-only";

import {
  SAMPLE_POSTAL_CODES,
  parseServicePoints,
  parseTracking,
  postnordHost,
  postnordProblem,
  servicePointsUrl,
  trackingUrl,
} from "@/lib/postnord";
import type { CarrierContext, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * PostNord's connection (D136), on the store's own API key: the service point search for where to collect, Track and Trace
 * for where a parcel is, and a check that the key works. Prices are not asked of PostNord (there is no price API): the store
 * enters them for checkout. In the store's test environment the calls go to PostNord's sandbox. Every call has a timeout, and
 * an answer that cannot be used is a plain sentence for the owner, so a page or checkout never depends on PostNord being up.
 */

const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

async function call(fetcher: Fetch, url: string): Promise<{ ok: true; json: unknown } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, problem: "PostNord did not answer. Try again in a moment." };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: postnordProblem(response.status) };
}

export function createPostnordAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  const host = (context: CarrierContext) => postnordHost(context.environment);
  const key = (context: CarrierContext) => context.secrets.apiKey ?? "";
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

    async track(context, trackingNumber) {
      const answer = await call(fetcher, trackingUrl(host(context), key(context), trackingNumber));
      if (!answer.ok) throw new Error(answer.problem);
      return parseTracking(answer.json);
    },
  };
}
