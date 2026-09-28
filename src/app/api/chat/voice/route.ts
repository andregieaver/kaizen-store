import { connection } from "next/server";

import { t } from "@/lib/i18n";
import { AiError, canSpeak, speakText, transcribeAudio } from "@/server/ai";
import { answer, chatContext, fail, sameSite, takeTurn } from "@/server/chat-route";

/** A spoken message: at most this many bytes of audio (about a minute). */
const AUDIO_MAX = 2 * 1024 * 1024;

/**
 * A visitor's spoken message to a site's chat agent (D81): the recording,
 * written down by the site's speech-to-text model, answered as a typed
 * message would be, and the answer read out by its text-to-speech model.
 * The recording and the reading are not kept.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "The chat could not read that recording.");
  }
  const audio = form.get("audio");
  const raw = form.get("request");
  if (!(audio instanceof Blob) || typeof raw !== "string" || raw.length > 40_000) return fail(400, "The chat could not read that recording.");
  if (audio.size === 0 || audio.size > AUDIO_MAX) return fail(413, "That recording is too long.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail(400, "The chat could not read that recording.");
  }

  // The conversation so far, with a stand-in for what was said until it is written down.
  const history = Array.isArray(body.messages) ? body.messages : [];
  const context = await chatContext({ ...body, messages: [...history, { role: "user", content: "…" }] });
  if (context instanceof Response) return context;
  const m = t(context.lang);
  if (!context.agent.voice || !canSpeak(context.connection)) return fail(404, m.chat.sorry);
  // Counted before the recording is written down, so the limits cover the voice models too.
  const refused = await takeTurn(context, request);
  if (refused) return refused;

  let transcript: string;
  try {
    const type = audio.type || "audio/webm";
    const extension = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
    transcript = (await transcribeAudio(context.connection, audio, `message.${extension}`, context.lang.split("-")[0])).slice(0, 1000);
  } catch (error) {
    console.warn(`[chat] transcription: ${error instanceof Error ? error.message : String(error)}`);
    return fail(503, m.chat.sorry);
  }
  if (!transcript) return fail(422, m.chat.didntHear);
  context.request.messages[context.request.messages.length - 1] = { role: "user", content: transcript };

  const reply = await answer(context);
  if (reply instanceof Response) return reply;
  let spoken: string | null = null;
  try {
    spoken = Buffer.from(await speakText(context.connection, reply.reply.slice(0, 1500))).toString("base64");
  } catch (error) {
    // The answer still shows as text.
    if (!(error instanceof AiError)) throw error;
    console.warn(`[chat] speech: ${error.message}`);
  }
  return Response.json({ ...reply, transcript, audio: spoken }, { headers: { "Cache-Control": "no-store" } });
}
