import { connection } from "next/server";

import { changeInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorHandoff } from "@/server/support-route";

/** *Talk to a person* (D216, 2.3): with the AI first, the visitor's conversation goes from the assistant to the queue. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = changeInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that message.");
  const answer = await visitorHandoff(raw, input.data.conversation, input.data.after);
  return answer instanceof Response ? answer : reply(answer);
}
