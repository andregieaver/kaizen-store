import { connection } from "next/server";

import { confirmInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorConfirm } from "@/server/support-route";

/** The confirm card (D216, 2.1): Confirm or No thanks to something the assistant proposed; it runs only on Confirm. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = confirmInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that answer.");
  const answer = await visitorConfirm(raw, input.data.conversation, input.data.after, input.data.action, input.data.confirm);
  return answer instanceof Response ? answer : reply(answer);
}
