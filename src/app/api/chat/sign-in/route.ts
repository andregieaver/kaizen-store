import { connection } from "next/server";

import { signInInput } from "@/lib/support-visitor-schema";
import { fail, sameSite } from "@/server/chat-route";
import { readBody, visitorSignIn } from "@/server/support-route";

/** The chat's sign-in card, first step (D216, 2.1): a code to the email, with the same answer whether or not it has an account. */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "The chat takes messages from its own site only.");
  const raw = await readBody(request);
  if (raw instanceof Response) return raw;
  const input = signInInput.safeParse(raw);
  if (!input.success) return fail(400, "The chat could not read that email.");
  return visitorSignIn(raw, input.data.conversation, input.data.email);
}
