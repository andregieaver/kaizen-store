import { assistantTurn } from "@/server/assistant-route";
import { getAccount } from "@/server/auth";

/** A turn of the AI manager (D103) can take a few tool rounds. */
export const maxDuration = 300;

/** A platform admin's message to Kaizen's AI manager: platform admins only. */
export async function POST(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  return assistantTurn(request, { account, store: null });
}
