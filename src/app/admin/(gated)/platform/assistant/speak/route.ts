import { assistantSpeech } from "@/server/assistant-route";
import { getAccount } from "@/server/auth";

/** A sentence of Kaizen's AI manager's answer, spoken (D104): platform admins only. */
export async function POST(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  return assistantSpeech(request, null, account.id);
}
