import { unsubscribe } from "@/server/cart-reminders";
import { unsubscribeByToken } from "@/server/marketing-subscribers";
import { unsubscribeFromPlanReminders } from "@/server/plan-reminders";

/**
 * One-click unsubscribe (RFC 8058) from a store's marketing email (D295), cart
 * reminder or Kaizen's plan reminder (D33): mail apps POST here when the reader
 * unsubscribes.
 */
export async function POST(_request: Request, { params }: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await params;
  if (token.length > 64) return new Response("Not found", { status: 404 });
  const done = (await unsubscribeByToken(token, "one_click")) ?? (await unsubscribe(token)) ?? (await unsubscribeFromPlanReminders(token));
  return done ? new Response("Unsubscribed", { status: 200 }) : new Response("Not found", { status: 404 });
}
