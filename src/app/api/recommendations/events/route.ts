import { connection } from "next/server";

import { recommendEvents } from "@/lib/recommendations";
import { visitorKey } from "@/server/chat-agent";
import { fail, sameSite } from "@/server/chat-route";
import { recordRecommendEvents, takeRecommendRequest } from "@/server/recommend-events";
import { getOpenStore } from "@/server/stores";

/**
 * A tab's report of the recommendations it showed and the ones clicked (D139), for the owner's figures: product ids, the
 * placement, and the ranking the tab got, under a random id the tab made. No cookie is set and nothing identifies a person.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return new Response(null, { status: 403 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4_000) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = recommendEvents.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  const store = await getOpenStore(parsed.data.store);
  if (!store) return fail(404, "No such store.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!(await takeRecommendRequest(store.id, visitorKey(address), "report"))) return new Response(null, { status: 429 });
  await recordRecommendEvents(store.id, parsed.data);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
