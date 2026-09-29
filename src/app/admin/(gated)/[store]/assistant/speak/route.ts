import { assistantSpeech } from "@/server/assistant-route";
import { getMembership } from "@/server/auth";

/** A sentence of the store's AI manager's answer, spoken (D104): owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/speak">) {
  const member = await getMembership((await params).store);
  if (!member || member.role !== "owner") return new Response("Not found", { status: 404 });
  return assistantSpeech(request, member.store.id, member.account.id);
}
