import { applyEmailEvent, verifyEmailEvent } from "@/server/email-events";
import { receiveInboundEvent, type InboundEvent } from "@/server/support-inbound";

/** Room for an email received to be answered by the AI after the reply (D332). */
export const maxDuration = 60;

/**
 * Resend calls this when an email is delivered, bounces or is marked as
 * spam (D32), and when an email arrives for the support desks' receiving
 * domain (`email.received`, D332). Only events signed with
 * RESEND_WEBHOOK_SECRET are trusted.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Not set up", { status: 503 });
  const body = await request.text();
  const signed = verifyEmailEvent(
    body,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
  );
  if (!signed) return new Response("Invalid signature", { status: 400 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  try {
    if ((event as { type?: unknown } | null)?.type === "email.received") {
      await receiveInboundEvent(event as InboundEvent);
      return Response.json({ received: true });
    }
    await applyEmailEvent(event as Parameters<typeof applyEmailEvent>[0]);
  } catch {
    // Resend retries failed deliveries with backoff.
    return new Response("Could not record the event", { status: 500 });
  }
  return Response.json({ received: true });
}
