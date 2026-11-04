import { NextResponse, type NextRequest } from "next/server";

import { finishMoverConnect } from "@/server/woocommerce-connect";

/**
 * Our WordPress plugin's post of the secret it made when the owner pressed Allow on his own site (D446 step 2): JSON with the sealed note,
 * the secret and the site, checked and kept by `finishMoverConnect()`. Server to server; the answer tells the plugin where to send the owner.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 10_000) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const result = await finishMoverConnect(body);
  return result.back
    ? NextResponse.json({ back: result.back }, { status: result.status, headers: { "Cache-Control": "no-store" } })
    : new NextResponse(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
