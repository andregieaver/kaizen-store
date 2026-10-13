import { connection } from "next/server";

import { rateInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, reply, visitorRate } from "@/server/support-route";

/** The rating card (D216, 2.1): "Did we help?" for an ended conversation, with an optional comment. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = rateInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that answer.");
  const answer = await visitorRate(raw, input.data.conversation, input.data.after, input.data.rating, input.data.comment);
  return answer instanceof Response ? answer : reply(answer);
}
