import { connection } from "next/server";

import { turnInput } from "@/lib/support-visitor-schema";
import { chatContext, chatPlace, fail, sameSite, takeTurn } from "@/server/chat-route";
import { log } from "@/server/log";
import { NO_STORE, readBody, reply, visitorTurn } from "@/server/support-route";

/** What a chat that streams asks for (PSI PERF-08): lines of JSON, `{"text"}` as the answer grows and then `{"status","body"}`. */
const STREAM_TYPE = "application/x-ndjson";

/**
 * A visitor's message to a site's chat (D81, D216): only the new message and the conversation's reference come from the browser;
 * the conversation is kept in the database (`support_conversations`), made on the first message and continued with its token. The
 * answer is every message after the one the tab last saw, with the conversation's state. A request that accepts `STREAM_TYPE` is
 * answered in lines instead: the AI's finished sentences so far, cleaned, each time they grow (`{"text"}`; empty again when it turns to
 * a tool after all), then the status and body the plain answer would have had; a refusal before the turn is a plain answer either way.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const place = await chatPlace(raw);
  if (place instanceof Response) return place;
  const context = await chatContext(place);
  if (context instanceof Response) return context;
  const input = turnInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that message.");
  const refused = await takeTurn(context, request);
  if (refused instanceof Response) return refused;
  const limited = refused === "limit";
  if (!(request.headers.get("accept") ?? "").includes(STREAM_TYPE)) {
    const answer = await visitorTurn(context, input.data, input.data.message, { limited });
    return answer instanceof Response ? answer : reply(answer);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        const answer = await visitorTurn(context, input.data, input.data.message, { limited, onText: (text) => line({ text }) });
        const done = answer instanceof Response ? answer : reply(answer);
        line({ status: done.status, body: await done.json().catch(() => ({})) });
      } catch (error) {
        log("error", "chat.stream_failed", {}, error);
        line({ status: 500, body: {} });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...NO_STORE, "content-type": `${STREAM_TYPE}; charset=utf-8` } });
}
