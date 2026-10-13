import { connection } from "next/server";

import { feedInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorFeedReply } from "@/server/support-route";

/** What is new in the visitor's conversation since the message the tab last saw (D216): its state and the messages after it. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = feedInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that message.");
  const answer = await visitorFeedReply(raw, input.data.conversation, input.data.after);
  return answer instanceof Response ? answer : reply(answer);
}
