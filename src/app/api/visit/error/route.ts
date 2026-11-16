import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { recordPageError } from "@/server/analytics-visits";

/**
 * A store page that failed to render (`docs/100-day-challenge.md` F4, D663), sent by the store's error page where the visit beacon runs. POST
 * only, from the same site, at most 1000 bytes, always an empty 204 that is never cached. `recordPageError()` marks the visitor's counted visit
 * of the day with the time of its first error, with the same checks as a page view; it starts no visit, so an error never counts a visitor.
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
    await recordPageError({ headers: request.headers, body });
  } catch (error) {
    console.warn(`[visits] ${error instanceof Error ? error.message : String(error)}`);
  }
  return quiet();
}
