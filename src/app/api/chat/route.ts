import { connection } from "next/server";

import { turnInput } from "@/lib/support-visitor-schema";
import { chatContext, chatPlace, fail, sameSite, takeTurn } from "@/server/chat-route";
import { readBody, reply, visitorTurn } from "@/server/support-route";

/**
 * A visitor's message to a site's chat (D81, D216): only the new message and the conversation's reference come from the browser;
 * the conversation is kept in the database (`support_conversations`), made on the first message and continued with its token. The
 * answer is every message after the one the tab last saw, with the conversation's state.
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
  if (refused) return refused;
  const answer = await visitorTurn(context, input.data, input.data.message);
  return answer instanceof Response ? answer : reply(answer);
}
