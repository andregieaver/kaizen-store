import "server-only";

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { AiError, aiFor, speakText } from "./ai";
import { sameSite } from "./chat-route";
import { runTurn, type AssistantEvent, type Principal } from "./owner-assistant";

const turnInput = z.object({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(4000),
  /** The admin page the person is on. */
  path: z.string().max(500).nullish(),
  /** Said in voice mode: the answer is read aloud. */
  voice: z.boolean().optional(),
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
          voice: input.data.voice === true,
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

const speechInput = z.object({ text: z.string().trim().min(1).max(600) });

/**
 * One piece of the AI manager's answer, spoken (D104): voice mode sends
 * each sentence as it is written and plays the pieces in turn, so speech
 * starts before the answer is done. MP3, with the site's own voice (D73).
 * The route has checked who is asking.
 */
export async function assistantSpeech(request: Request, storeId: string | null): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const input = speechInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Nothing to say." }, { status: 400 });
  const connection = await aiFor(storeId);
  if (!connection?.speechModel || !connection.speechVoice) return Response.json({ error: "No voice is set up." }, { status: 409 });
  try {
    const audio = await speakText(connection, input.data.text);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
}
