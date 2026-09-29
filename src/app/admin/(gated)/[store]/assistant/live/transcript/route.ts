import { liveTranscriptResponse } from "@/server/assistant-route";
import { getMembership } from "@/server/auth";

/** Keeps what was said on a live call with the store's AI manager (D105): owners only. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/live/transcript">) {
  const member = await getMembership((await params).store);
  if (!member || member.role !== "owner") return new Response("Not found", { status: 404 });
  return liveTranscriptResponse(request, member);
}
