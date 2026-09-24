import { applyEmailEvent, verifyEmailEvent } from "@/server/email-events";

/**
 * Resend calls this when an email is delivered, bounces or is marked as
 * spam (D32). Only events signed with RESEND_WEBHOOK_SECRET are trusted.
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
    await applyEmailEvent(event as Parameters<typeof applyEmailEvent>[0]);
  } catch {
    // Resend retries failed deliveries with backoff.
    return new Response("Could not record the event", { status: 500 });
  }
  return Response.json({ received: true });
}
