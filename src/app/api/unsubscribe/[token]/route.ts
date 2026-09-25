import { unsubscribe } from "@/server/cart-reminders";

/**
 * One-click unsubscribe (RFC 8058) from a cart reminder's List-Unsubscribe
 * header (D33): mail apps POST here when the reader chooses to unsubscribe.
 */
export async function POST(_request: Request, { params }: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await params;
  if (token.length > 64) return new Response("Not found", { status: 404 });
  const done = await unsubscribe(token);
  return done ? new Response("Unsubscribed", { status: 200 }) : new Response("Not found", { status: 404 });
}
