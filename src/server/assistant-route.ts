import "server-only";

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { AiError, aiFor, speakText } from "./ai";
import { sameSite } from "./chat-route";
import { delegateLive, endLiveCall, LiveVoiceError, saveLiveTurns, startLiveSession } from "./live-voice";
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
export async function assistantSpeech(request: Request, storeId: string | null, accountId: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const input = speechInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Nothing to say." }, { status: 400 });
  const connection = await aiFor(storeId, { feature: "ai_manager", accountId });
  if (!connection?.speechModel || !connection.speechVoice) return Response.json({ error: "No voice is set up." }, { status: 409 });
  try {
    const audio = await speakText(connection, input.data.text);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
}

// Live voice (D105) --------------------------------------------------------------------------

const liveStart = z.object({ sdp: z.string().min(10).max(20_000).startsWith("v="), conversationId: z.uuid().nullish() });

/** Starts a live voice call for the person the route admitted: the page's WebRTC offer in, the provider's answer out. */
export async function liveSessionResponse(request: Request, principal: Principal): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const input = liveStart.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "The call could not be read." }, { status: 400 });
  try {
    return Response.json(await startLiveSession(principal, { sdp: input.data.sdp, conversationId: input.data.conversationId ?? null }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof LiveVoiceError) return Response.json({ error: error.message }, { status: 502 });
    throw error;
  }
}

/** Runs what the call handed over as a turn of the AI manager; always something to say, since silence on a live call is worse. */
export async function liveDelegateResponse(request: Request, principal: Principal): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { conversationId?: unknown; turns?: unknown; path?: unknown } | null;
  const tasks: (() => Promise<unknown>)[] = [];
  after(async () => {
    for (const task of tasks) await task();
  });
  try {
    const result = await delegateLive(
      principal,
      { conversationId: body?.conversationId, turns: body?.turns, path: typeof body?.path === "string" ? body.path.slice(0, 500) : null },
      (tag) => revalidateTag(tag, "max"),
      (task) => tasks.push(task),
    );
    if (!result) return Response.json({ error: "Unknown conversation." }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[live-voice] delegate", error);
    return Response.json({ speak: "That didn't go through on my side. Tell them it failed and offer to try again.", navigate: [], approvals: [], failed: true });
  }
}

/** Keeps finished turns of a call; also sent as a beacon when the page closes, so the body is read as text. */
export async function liveTranscriptResponse(request: Request, principal: Principal): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  let body: { conversationId?: unknown; turns?: unknown } | null = null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const saved = await saveLiveTurns(principal, body?.conversationId, body?.turns);
  if (saved === null) return Response.json({ error: "Unknown conversation." }, { status: 404 });
  // The page's last message also says how long the call was (usage, D106).
  const ended = body as { sessionId?: unknown; seconds?: unknown } | null;
  if (ended?.sessionId !== undefined) await endLiveCall(principal, ended.sessionId, ended.seconds);
  return Response.json({ saved });
}
