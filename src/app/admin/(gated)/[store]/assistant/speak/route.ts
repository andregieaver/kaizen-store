import { assistantSpeech } from "@/server/assistant-route";
import { checkOwnerRole } from "@/server/permissions";

/** A sentence of the store's AI manager's answer, spoken (D104): owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/speak">) {
  const member = await checkOwnerRole((await params).store);
  if (!member) return new Response("Not found", { status: 404 });
  return assistantSpeech(request, member.store.id, member.account.id);
}
