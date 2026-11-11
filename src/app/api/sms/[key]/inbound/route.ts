import { connection } from "next/server";

import { takeBudget } from "@/server/request-budget";
import { receiveSms } from "@/server/sms";

/**
 * Texts a store's 46elks number receives (SMS marketing, D565): 46elks posts each one here (form-encoded `from`, `to`, `message`), the store
 * named by the key in the address, which only 46elks is given. A STOP reply ends that number's texts at once; anything else is not kept.
 * Answered with no body, so 46elks sends no reply text.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/sms/[key]/inbound">) {
  await connection();
  const { key } = await params;
  if (!(await takeBudget(null, "sms", key.slice(0, 16)))) return new Response(null, { status: 429 });
  const form = await request.formData().catch(() => null);
  const from = String(form?.get("from") ?? "");
  const message = String(form?.get("message") ?? "").slice(0, 1600);
  const outcome = await receiveSms(key, from, message);
  return new Response(null, { status: outcome === "unknown" ? 404 : 204 });
}
