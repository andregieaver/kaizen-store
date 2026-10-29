import { connection } from "next/server";

import { recordConsent } from "@/server/consents";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

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
  // Budgeted per visitor and for the site (D389, SEC-10): a flood of records is refused before anything is written.
  const storeId = body && typeof body === "object" && typeof (body as { storeId?: unknown }).storeId === "string" ? (body as { storeId: string }).storeId : null;
  const site = storeId && /^[0-9a-f-]{36}$/i.test(storeId) ? storeId : null;
  if (!(await takeBudget(site, "consent", budgetVisitor(request.headers)))) return new Response(null, { status: 429, headers: { "Cache-Control": "no-store" } });
  const saved = await recordConsent(body);
  return new Response(null, { status: saved ? 204 : 400, headers: { "Cache-Control": "no-store" } });
}
