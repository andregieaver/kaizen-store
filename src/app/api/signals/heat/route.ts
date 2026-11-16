import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { log } from "@/server/log";
import { recordHeat } from "@/server/page-heat";

/**
 * One page view's heatmap summary (D656, `docs/heatmaps-and-recordings.md` 8.1), sent by the storefront's collector for a visitor who
 * allowed statistics while the store's heatmaps are on. POST only, from the same site, at most 8,000 bytes, and always answered with an
 * empty 204 that is never cached, whether it was kept or not, so a script learns nothing from it. `recordHeat()` keeps daily totals only.
 */

const MAX_BYTES = 8000;
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
    await recordHeat({ headers: request.headers, body });
  } catch (error) {
    // Measuring is never worth an error in a visitor's browser.
    log("warn", "heat.record_failed", {}, error);
  }
  return answer(204);
}
