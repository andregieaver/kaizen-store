import { NextResponse, type NextRequest } from "next/server";

import { handleShopifyWebhook } from "@/server/shopify-connect";

/**
 * Shopify's webhooks to Kaizena Flow's app (D445 step 2, `shopify/shopify.app.toml`): `app/uninstalled` and the three privacy topics,
 * checked against Shopify's HMAC over the raw body (401 without it, as Shopify requires) and answered by `handleShopifyWebhook()`.
 */
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return new NextResponse(null, { status: 413 });
  const status = await handleShopifyWebhook(raw, {
    hmac: request.headers.get("x-shopify-hmac-sha256"),
    topic: request.headers.get("x-shopify-topic"),
    shop: request.headers.get("x-shopify-shop-domain"),
  });
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}
