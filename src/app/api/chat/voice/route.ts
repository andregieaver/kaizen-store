import { connection } from "next/server";

import { t } from "@/lib/i18n";
import { MESSAGE_MAX } from "@/lib/support-rules";
import type { VisitorReply } from "@/lib/support-visitor";
import { BODY_MAX, spokenTurnInput } from "@/lib/support-visitor-schema";
import { AiError, canSpeak, speakText, transcribeAudio } from "@/server/ai";
import { chatContext, chatPlace, fail, sameSite, takeTurn } from "@/server/chat-route";
import { NO_STORE, visitorTurn } from "@/server/support-route";

/** A spoken message: at most this many bytes of audio (about a minute). */
const AUDIO_MAX = 2 * 1024 * 1024;

/**
 * A visitor's spoken message to a site's chat agent (D81, D216): the recording, written down by the site's speech-to-text model,
 * kept and answered as a typed message is (the conversation's history comes from the database, however long it is), and the
 * answer read out by its text-to-speech model. The recording and the reading are not kept.
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
  if (!(audio instanceof Blob) || typeof raw !== "string" || raw.length > BODY_MAX) return fail(400, "The chat could not read that recording.");
  if (audio.size === 0 || audio.size > AUDIO_MAX) return fail(413, "That recording is too long.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "The chat could not read that recording.");
  }

  const place = await chatPlace(body);
  if (place instanceof Response) return place;
  const context = await chatContext(place);
  if (context instanceof Response) return context;
  const input = spokenTurnInput.safeParse(body);
  if (!input.success) return fail(400, "The chat could not read that recording.");
  const m = t(context.lang);
  // Voice is the AI's: it needs an agent that listens and the site's speech models (never with people only).
  const voice = context.agent?.voice && context.connection && canSpeak(context.connection) ? context.connection : null;
  if (!voice) return fail(404, m.chat.sorry);
  // Counted before the recording is written down, so the limits cover the voice models too; past the site's limit there is no model to write it down.
  const refused = await takeTurn(context, request);
  if (refused instanceof Response) return refused;
  if (refused === "limit") return fail(429, m.chat.closed);

  let transcript: string;
  try {
    const type = audio.type || "audio/webm";
    const extension = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
    transcript = (await transcribeAudio(voice, audio, `message.${extension}`, context.lang.split("-")[0])).trim().slice(0, MESSAGE_MAX.customer);
  } catch (error) {
    console.warn(`[chat] transcription: ${error instanceof Error ? error.message : String(error)}`);
    return fail(503, m.chat.sorry);
  }
  if (!transcript) return fail(422, m.chat.didntHear);

  const answer = await visitorTurn(context, input.data, transcript);
  if (answer instanceof Response) return answer;
  const said = lastAnswer(answer);
  let spoken: string | null = null;
  if (said) {
    try {
      spoken = Buffer.from(await speakText(voice, said.slice(0, 1500))).toString("base64");
    } catch (error) {
      // The answer still shows as text.
      if (!(error instanceof AiError)) throw error;
      console.warn(`[chat] speech: ${error.message}`);
    }
  }
  return Response.json({ ...answer, transcript, audio: spoken }, { headers: NO_STORE });
}

/** The words to read out: the AI's last answer in this reply. */
function lastAnswer(reply: VisitorReply): string | null {
  return reply.messages.filter((message) => message.author === "ai").at(-1)?.body ?? null;
}
