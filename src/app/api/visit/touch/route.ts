import { connection } from "next/server";

import { recordTouch } from "@/server/analytics-visits";
import { sameSite } from "@/server/chat-route";

/**
 * A visitor's first visit in 30 days (D303 I3), from `TouchKeeper` while they allow statistics cookies: kept on today's visit by
 * `recordTouch()`. Same site, small, always an empty 204 that is never cached, so a script learns nothing from it.
 */
export async function POST(request: Request) {
  await connection();
  const quiet = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    if (!sameSite(request)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    const text = await request.text();
    if (text.length > 600) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
    await recordTouch({ headers: request.headers, body: JSON.parse(text) });
  } catch (error) {
    console.warn(`[visits] touch: ${error instanceof Error ? error.message : String(error)}`);
  }
  return quiet;
}
