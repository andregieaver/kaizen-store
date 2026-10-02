import { connection } from "next/server";

import { sameSite } from "@/server/chat-route";
import { recordVisit } from "@/server/analytics-visits";

/**
 * A page view from a store's own pages (D152, docs/analytics.md, "Visit counting"), sent by `VisitBeacon` while the store
 * counts visits. POST only. From the same site only, at most 1000 bytes, and always answered with an empty 204 that is
 * never cached, whether the view was counted or not, so a script learns nothing from it. No cookie is set or read.
 * `recordVisit()` drops robots and visitors who send Global Privacy Control or Do Not Track, drops a request whose
 * Origin/Referer is not a page of the store named in the body, bounds the new rows an address and a store can start in a
 * day, and keeps no IP address and no user agent. The bounds make inflating the count harder; they do not prevent it.
 */

const MAX_BYTES = 1000;
const quiet = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  try {
    if (!sameSite(request)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BYTES) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    await recordVisit({ headers: request.headers, body });
  } catch (error) {
    // Counting is never worth an error in a visitor's browser.
    console.warn(`[visits] ${error instanceof Error ? error.message : String(error)}`);
  }
  return quiet();
}
