import { connection } from "next/server";

import { sameSite } from "@/server/chat-route";
import { recordSpeed } from "@/server/analytics-speed";
import { log } from "@/server/log";

/**
 * One page load's speed (D336, `docs/analytics.md` "Speed"), sent by `SpeedBeacon` while the store counts visits. POST only, from the
 * same site, at most 1000 bytes, and always answered with an empty 204 that is never cached, whether it was kept or not, so a script
 * learns nothing from it. No cookie is set or read; `recordSpeed()` keeps the page's kind and the screen only.
 */

const MAX_BYTES = 1000;
const answer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  try {
    if (!sameSite(request)) return answer(403);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BYTES) return answer(413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return answer(413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return answer(400);
    }
    await recordSpeed({ headers: request.headers, body });
  } catch (error) {
    // Measuring is never worth an error in a visitor's browser.
    log("warn", "speed.record_failed", {}, error);
  }
  return answer(204);
}
