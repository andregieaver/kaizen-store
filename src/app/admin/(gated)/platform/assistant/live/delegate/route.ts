import { liveDelegateResponse } from "@/server/assistant-route";
import { getAccount } from "@/server/auth";

/** A handed-over request is a full AI manager turn: a few tool rounds. */
export const maxDuration = 300;

/** Does the work a live call with Kaizen's AI manager handed over (D105): platform admins only. */
export async function POST(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  return liveDelegateResponse(request, { account, store: null });
}
