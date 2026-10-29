import { connection } from "next/server";

import { sameSite } from "@/server/chat-route";
import { log } from "@/server/log";
import { recordOwnSpeed } from "@/server/own-speed";

/**
 * One page load's speed of Kaizena Flow's own site or of the admin (wave 11 unit K, D390), sent by `SpeedBeacon`. As the stores' route:
 * POST only, from the same site, at most 1000 bytes, always an empty 204 that is never cached; no cookie set or read.
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
    await recordOwnSpeed({ headers: request.headers, body });
  } catch (error) {
    log("warn", "own_speed.record_failed", {}, error);
  }
  return answer(204);
}
