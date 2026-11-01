import { assistantStop } from "@/server/assistant-route";
import { getAccount } from "@/server/auth";

/** Stop, pressed on purpose in Kaizen's AI manager (PSI AGT-03): platform admins only, their own conversation. */
export async function POST(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  return assistantStop(request, { account, store: null });
}
