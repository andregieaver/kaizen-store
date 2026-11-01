import { assistantStop } from "@/server/assistant-route";
import { checkOwnerRole } from "@/server/permissions";

/** Stop, pressed on purpose in the store's AI manager (PSI AGT-03): owners only, their own conversation. */
export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/assistant/turn/stop">) {
  const member = await checkOwnerRole((await params).store);
  if (!member) return new Response("Not found", { status: 404 });
  return assistantStop(request, member);
}
