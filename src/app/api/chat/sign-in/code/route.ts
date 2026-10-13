import { connection } from "next/server";

import { signInCodeInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, visitorSignInCode } from "@/server/support-route";

/** The chat's sign-in card, second step (D216, 2.1): the emailed code signs the visitor in and links the conversation to them. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = signInCodeInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that code.");
  return visitorSignInCode(raw, input.data.conversation, input.data.after, input.data.email, input.data.code);
}
