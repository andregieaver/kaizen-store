import { statusRequest } from "@/server/replicate-route";

/** How a copy is going (D150): its step, log, previews and summary. */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/pages/ai/replicate/[jobId]">) {
  const { store, jobId } = await params;
  return statusRequest(request, store, jobId);
}
