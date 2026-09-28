import { revalidateTag } from "next/cache";
import { z } from "zod";

import { getMembership } from "@/server/auth";
import { sameSite } from "@/server/chat-route";
import { runTurn, type AssistantEvent } from "@/server/owner-assistant";

/** A turn of the owner assistant (D94) can take a few tool rounds. */
export const maxDuration = 300;

const turnInput = z.object({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(4000),
});

/**
 * The owner's message to the store's assistant (D94), answered as a stream
 * of events, one JSON object per line: the text as it is written, the tools
 * it uses, approvals it asks for, and the saved answer. Owners only, from
 * the admin itself.
 */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/turn">) {
  const member = await getMembership((await params).store);
  if (!member || member.role !== "owner") return new Response("Not found", { status: 404 });
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const input = turnInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "The message could not be read." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The owner has gone; the turn still finishes and is kept.
        }
      };
      try {
        await runTurn({
          member,
          conversationId: input.data.conversationId,
          message: input.data.message,
          emit,
          invalidate: (tag) => revalidateTag(tag, "max"),
          signal: request.signal,
        });
      } catch (error) {
        console.error("[owner-assistant] turn", error);
        emit({ type: "error", message: "Something went wrong. Try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
