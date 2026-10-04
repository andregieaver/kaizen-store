import { liveSessionResponse } from "@/server/assistant-route";
import { checkOwnerRole } from "@/server/permissions";

/** Starts a live voice call with the store's AI manager (D105): owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/live">) {
  const member = await checkOwnerRole((await params).store);
  if (!member) return new Response("Not found", { status: 404 });
  return liveSessionResponse(request, member);
}
