import { createHmac, timingSafeEqual } from "node:crypto";

import { usageDrainEnv } from "@/lib/env";
import { parseDrainBody, trafficTotals } from "@/lib/usage-drain";
import { addTraffic, storeResolver } from "@/server/usage-traffic";

/** The signature Vercel sends: the body's HMAC-SHA1 with the drain's secret, in hex (vercel.com/docs/drains/security). */
function signedBy(body: string, given: string | null, secret: string): boolean {
  if (!given) return false;
  const expected = Buffer.from(createHmac("sha1", secret).update(body).digest("hex"));
  const received = Buffer.from(given.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Vercel's log drain (D314, `docs/capacity.md` step 1.4): requests and server errors per store and day, nothing of the visitor. Off (404)
 * without `USAGE_DRAIN_SECRET`; a body that is not signed with it is refused.
 */
export async function POST(request: Request) {
  const drain = usageDrainEnv();
  if (!drain) return new Response("Not found", { status: 404 });
  const body = await request.text();
  if (!signedBy(body, request.headers.get("x-vercel-signature"), drain.secret)) {
    return Response.json({ code: "invalid_signature" }, { status: 403 });
  }
  try {
    const { totals, unknownHosts } = trafficTotals(parseDrainBody(body), await storeResolver(), drain.sampleRate);
    const written = await addTraffic(totals);
    return Response.json({ written, unknownHosts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[usage] drain", error instanceof Error ? error.message : "failed");
    return Response.json({ code: "failed" }, { status: 500 });
  }
}
