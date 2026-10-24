import { cookies } from "next/headers";
import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { recordAdSignals } from "@/server/ad-conversions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shopper's marketing consent and the ad platforms' ids on their own open carts (wave 5 unit I2, D303): sent by the consent manager, never
 * on a pay route. Carts are found only by the shopper's own cart cookies of the store named (`cart_{store}_{market}`); with consent withdrawn
 * both are cleared. The answer says nothing about what it found.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return new Response(null, { status: 403 });
  let body: { store?: unknown; consent?: unknown; signals?: unknown };
  try {
    const text = await request.text();
    if (text.length > 4000) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body.store !== "string" || !UUID.test(body.store)) return new Response(null, { status: 400 });
  const prefix = `cart_${body.store.toLowerCase()}_`;
  const cartIds = (await cookies())
    .getAll()
    .filter((c) => c.name.startsWith(prefix) && UUID.test(c.value))
    .map((c) => c.value)
    .slice(0, 10);
  await recordAdSignals(body.store, cartIds, body.consent === true, body.signals);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
