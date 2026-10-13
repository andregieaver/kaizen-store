import { connection } from "next/server";

import { emailInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorEmail } from "@/server/support-route";

/**
 * The email card (D216, 2.3): the email (and name) a visitor leaves so the desk's answers reach them. Typed, never proof: it is used
 * only to send the answers, never to match orders or accounts.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = emailInput.safeParse(raw);
  if (!input.success) return fail(400, "Write a valid email address.");
  const answer = await visitorEmail(raw, input.data.conversation, input.data.after, { name: input.data.name, email: input.data.email });
  return answer instanceof Response ? answer : reply(answer);
}
