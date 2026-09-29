import { liveDelegateResponse } from "@/server/assistant-route";
import { getMembership } from "@/server/auth";

/** A handed-over request is a full AI manager turn: a few tool rounds. */
export const maxDuration = 300;

/** Does the work a live call with the store's AI manager handed over (D105): owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/live/delegate">) {
  const member = await getMembership((await params).store);
  if (!member || member.role !== "owner") return new Response("Not found", { status: 404 });
  return liveDelegateResponse(request, member);
}
