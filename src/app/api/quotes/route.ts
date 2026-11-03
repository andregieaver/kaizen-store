import { connection } from "next/server";

import { fail, sameSite } from "@/server/chat-route";
import { formVisitor } from "@/server/forms";
import { requestQuote } from "@/server/quote-requests";

/**
 * A shopper asking for a quote (D431), from a product's page (its variants and quantities) or from the cart (its lines, read from the cart
 * itself), from the store's own pages only. The answer says it was received, what to correct, or that it was refused (too many, not offered).
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Requests come from the store's own pages only.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 20_000) return fail(413, "That is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "The request could not be read.");
  }
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const path = typeof (body as { path?: unknown })?.path === "string" ? String((body as { path: string }).path).slice(0, 500) : "/";
  const { status, body: answer } = await requestQuote(body, formVisitor(address), path);
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}
