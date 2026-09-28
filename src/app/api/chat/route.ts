import { connection } from "next/server";

import { answer, chatContext, fail, sameSite, takeTurn } from "@/server/chat-route";

/**
 * A visitor's message to a site's chat agent (D81): the conversation so
 * far, from their browser, and the site (a store in one of its countries,
 * or Kaizen's). The answer holds the agent's words, the page it opened and
 * the products it found. Nothing of it is kept.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 40_000) return fail(413, "That conversation is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "The chat could not read that message.");
  }
  const context = await chatContext(body);
  if (context instanceof Response) return context;
  const refused = await takeTurn(context, request);
  if (refused) return refused;
  const reply = await answer(context);
  if (reply instanceof Response) return reply;
  return Response.json(reply, { headers: { "Cache-Control": "no-store" } });
}
