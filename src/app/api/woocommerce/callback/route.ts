import { NextResponse, type NextRequest } from "next/server";

import { finishWooConnect } from "@/server/woocommerce-connect";

/**
 * WooCommerce's post of the read-only key the owner approved on his own site (D446 step 1, `docs/moving-from-woocommerce.md` 4.2): JSON
 * with the key, its permissions and the sealed note (`user_id`) it carried, checked and kept by `finishWooConnect()`. Server to server: the
 * owner's browser is sent back to the moving page by WooCommerce itself.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 20_000) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // WooCommerce posts JSON; a form body is read as one too, in case a site's plugin changed it.
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  const status = await finishWooConnect(body);
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}
