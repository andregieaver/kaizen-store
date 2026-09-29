import "server-only";

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { sameSite } from "./chat-route";
import { runTurn, type AssistantEvent, type Principal } from "./owner-assistant";

const turnInput = z.object({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(4000),
  /** The admin page the person is on. */
  path: z.string().max(500).nullish(),
});

/**
 * A message to the AI manager (D94, D103), answered as a stream of events,
 * one JSON object per line: the text as it is written, the tools it uses,
 * pages it opens, approvals it asks for, and the saved answer. What was
 * lasting in it is learned once the answer is sent. From the admin itself
 * only; the route has checked who is asking.
 */
export async function assistantTurn(request: Request, principal: Principal): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const input = turnInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "The message could not be read." }, { status: 400 });

  // Learning runs after the answer: registered now, while the request is in scope.
  const tasks: (() => Promise<unknown>)[] = [];
  let finished: () => void = () => {};
  const answered = new Promise<void>((resolve) => (finished = resolve));
  after(async () => {
    await answered;
    for (const task of tasks) await task();
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The person has gone; the turn still finishes and is kept.
        }
      };
      try {
        await runTurn({
          member: principal,
          conversationId: input.data.conversationId,
          message: input.data.message,
          emit,
          invalidate: (tag) => revalidateTag(tag, "max"),
          signal: request.signal,
          path: input.data.path,
          later: (task) => tasks.push(task),
        });
      } catch (error) {
        console.error("[ai-manager] turn", error);
        emit({ type: "error", message: "Something went wrong. Try again." });
      } finally {
        finished();
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
