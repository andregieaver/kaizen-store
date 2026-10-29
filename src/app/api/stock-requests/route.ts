import { connection } from "next/server";

import { isRequestAddress, type StockRequestReply } from "@/lib/stock-request-check";
import { sameSite } from "@/lib/same-site";
import { getCustomer } from "@/server/customers";
import { resolveSellingShop } from "@/server/shop";
import { cancelOwnStockRequest, requestStock, stockVisitor } from "@/server/stock-requests";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: StockRequestReply, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A shopper asking to hear when a sold-out variant is back (D298, docs/wave-5-marketing.md 6.4), from the store's own product page only. The
 * answer says the request waits, or that an email is on its way to confirm it; it never says whether the address was known.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return reply({ ok: false, error: "failed" }, 403);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2_000) return reply({ ok: false, error: "failed" }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: "failed" }, 400);
  }
  const { store, market, variant, email } = body;
  if (typeof store !== "string" || typeof market !== "string" || typeof variant !== "string" || !uuid.test(variant) || typeof email !== "string") {
    return reply({ ok: false, error: "failed" }, 400);
  }
  if (!isRequestAddress(email)) return reply({ ok: false, error: "invalid" }, 422);
  const shop = await resolveSellingShop(store.slice(0, 100), market.slice(0, 40));
  if (!shop) return reply({ ok: false, error: "failed" }, 404);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const customer = await getCustomer(shop.store.id);
  const answer = await requestStock({
    storeId: shop.store.id,
    marketCode: shop.market.code,
    locale: shop.market.locale,
    variantId: variant,
    email,
    visitor: stockVisitor(address),
    customerId: customer?.id ?? null,
  });
  if (answer === "waiting" || answer === "check") return reply({ ok: true, outcome: answer });
  if (answer === "invalid") return reply({ ok: false, error: "invalid" }, 422);
  if (answer === "busy") return reply({ ok: false, error: "busy" }, 429);
  return reply({ ok: false, error: "failed" }, 409);
}

/**
 * A signed-in customer stopping their own request for a variant from the product page (D392). Only their own verified address's request
 * stops; the answer is the same whether there was one.
 */
export async function DELETE(request: Request) {
  await connection();
  if (!sameSite(request)) return reply({ ok: false, error: "failed" }, 403);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2_000) return reply({ ok: false, error: "failed" }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: "failed" }, 400);
  }
  const { store, market, variant } = body;
  if (typeof store !== "string" || typeof market !== "string" || typeof variant !== "string" || !uuid.test(variant)) {
    return reply({ ok: false, error: "failed" }, 400);
  }
  const shop = await resolveSellingShop(store.slice(0, 100), market.slice(0, 40));
  if (!shop) return reply({ ok: false, error: "failed" }, 404);
  const customer = await getCustomer(shop.store.id);
  if (!customer) return reply({ ok: false, error: "failed" }, 401);
  await cancelOwnStockRequest(shop.store.id, customer.id, variant);
  return reply({ ok: true, outcome: "cancelled" });
}
