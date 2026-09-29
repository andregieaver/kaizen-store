import { assistantTurn } from "@/server/assistant-route";
import { getMembership } from "@/server/auth";

/** A turn of the AI manager (D94, D103) can take a few tool rounds. */
export const maxDuration = 300;

/** The owner's message to the store's AI manager: owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/turn">) {
  const member = await getMembership((await params).store);
  if (!member || member.role !== "owner") return new Response("Not found", { status: 404 });
  return assistantTurn(request, member);
}
