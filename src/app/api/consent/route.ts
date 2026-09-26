import { connection } from "next/server";

import { recordConsent } from "@/server/consents";

/**
 * Records a visitor's cookie choice as proof of consent (D58). Sent by the
 * consent widget as the choice is made; the choice itself lives in the
 * visitor's consent cookie, so a record that fails changes nothing for them.
 */
export async function POST(request: Request) {
  await connection();
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2000) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const saved = await recordConsent(body);
  return new Response(null, { status: saved ? 204 : 400, headers: { "Cache-Control": "no-store" } });
}
