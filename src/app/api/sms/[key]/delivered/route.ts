import { connection } from "next/server";

import { takeBudget } from "@/server/request-budget";
import { recordDelivery } from "@/server/sms";

/**
 * Delivery reports for a store's marketing texts (D565): 46elks posts each change (form-encoded `id`, `status`: sent, delivered or failed)
 * to the address the text was sent with, the store named by its key. Only the store's own messages change.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/sms/[key]/delivered">) {
  await connection();
  const { key } = await params;
  if (!(await takeBudget(null, "sms", key.slice(0, 16)))) return new Response(null, { status: 429 });
  const form = await request.formData().catch(() => null);
  const known = await recordDelivery(key, String(form?.get("id") ?? ""), String(form?.get("status") ?? ""));
  return new Response(null, { status: known ? 204 : 404 });
}
