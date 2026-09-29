import { liveTranscriptResponse } from "@/server/assistant-route";
import { getAccount } from "@/server/auth";

/** Keeps what was said on a live call with Kaizen's AI manager (D105): platform admins only. */
export async function POST(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  return liveTranscriptResponse(request, { account, store: null });
}
