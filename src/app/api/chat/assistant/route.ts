import { connection } from "next/server";

import { changeInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorAssistant } from "@/server/support-route";

/** *Continue with the assistant* (D216, 2.3): a visitor waiting for a person goes back to the AI. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = changeInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that message.");
  const answer = await visitorAssistant(raw, input.data.conversation, input.data.after);
  return answer instanceof Response ? answer : reply(answer);
}
