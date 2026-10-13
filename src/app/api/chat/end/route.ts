import { connection } from "next/server";

import { endInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorEnd } from "@/server/support-route";

/** The visitor ends their conversation (D216); a message from the same tab within a day reopens it. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = endInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that message.");
  const answer = await visitorEnd(raw, input.data.conversation, input.data.after);
  return answer instanceof Response ? answer : reply(answer);
}
